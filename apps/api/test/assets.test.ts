import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest, type ClientRequest, type Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import supertest from 'supertest';
import { questionV2Schema, mediaLimits, type QuestionV2, type Content } from '@amp/contracts';
import { createApp } from '../src/app.js';
import { Database } from '../src/database/database.js';
import { ids, seed } from '../src/database/seed.js';
import { migrate } from '../src/database/migrate.js';
import { AssetsService } from '../src/assets/assets.service.js';
import { byteRange } from '../src/assets/assets.controller.js';

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'TestPassword123!';
process.env.DATABASE_DRIVER = process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'memory://';
let app: Awaited<ReturnType<typeof createApp>>,
  db: Database,
  assets: AssetsService,
  http: ReturnType<typeof supertest>,
  directory: string;
const tokens: Record<string, string> = {};
const auth = (role = 'teacher') => `Bearer ${tokens[role]}`;
const text = (value: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text: value }] },
];
let picture: Buffer;
function wav(seconds = 1) {
  const samples = Math.round(8000 * seconds),
    data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 220) / 8000) * 4000), 44 + i * 2);
  return data;
}
const response = (): QuestionV2 =>
  questionV2Schema.parse({
    id: randomUUID(),
    type: 'RESPONSE',
    parentId: null,
    position: 0,
    prompt: text('Describe this picture and read aloud.'),
    answerAreaContent: [],
    points: 2,
    config: {
      textEnabled: true,
      textRequired: true,
      minImages: 0,
      maxImages: 5,
      minAudios: 0,
      maxAudios: 2,
      rubric: [
        {
          id: randomUUID(),
          name: 'Meaning',
          description: 'Communicate the intended meaning.',
          points: 2,
        },
      ],
    },
    answerKey: {},
  });
const create = async () =>
  (
    await http
      .post('/api/assignments')
      .set('Authorization', auth())
      .send({
        schemaVersion: 2,
        classId: ids.classroom,
        title: randomUUID(),
        description: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        questions: [response()],
      })
      .expect(201)
  ).body;
async function init(
  a: { id: string; questions: QuestionV2[] },
  role = 'teacher',
  kind = 'image',
  name = 'image.png',
  mime = 'image/png',
  bytes = picture.length,
  node = randomUUID(),
) {
  const teaching = role === 'teacher' || role === 'other.teacher';
  return (
    await http
      .post('/api/assets/uploads')
      .set('Authorization', auth(role))
      .send({
        uploadRequestId: randomUUID(),
        assignmentId: a.id,
        questionId: a.questions[0]!.id,
        contentNodeId: teaching ? node : null,
        purpose: teaching ? 'TEACHING' : 'ANSWER',
        kind,
        name,
        mime,
        bytes,
      })
      .expect(201)
  ).body;
}
function upload(
  id: string,
  data: Buffer,
  name = 'image.png',
  mime = 'image/png',
  role = 'teacher',
) {
  return http
    .post(`/api/assets/uploads/${id}/content`)
    .set('Authorization', auth(role))
    .attach('file', data, { filename: name, contentType: mime });
}
async function processed(id: string) {
  for (let n = 0; n < 50; n++) {
    const [row] = await db.query('SELECT status FROM assets WHERE id=$1', [id]);
    if (row?.status !== 'PROCESSING') return row?.status;
    if (!(await assets.processNext())) break;
  }
  throw new Error('Asset did not reach a terminal processing state.');
}
async function publish(a: { id: string; version: number }) {
  return (
    await http
      .post(`/api/assignments/${a.id}/publish`)
      .set('Authorization', auth())
      .send({ schemaVersion: 2, version: a.version })
      .expect(201)
  ).body;
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'amp-media-test-'));
  process.env.ASSET_DIRECTORY = directory;
  app = await createApp(true);
  db = app.get(Database);
  assets = app.get(AssetsService);
  await migrate(db);
  await seed(db);
  http = supertest(app.getHttpServer());
  for (const role of ['teacher', 'student', 'other.teacher', 'other.student'])
    tokens[role] = (
      await http
        .post('/api/auth/login')
        .send({ email: `${role}@example.test`, password: process.env.DEMO_PASSWORD })
        .expect(201)
    ).body.token;
  picture = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#225588' } })
    .png()
    .toBuffer();
});
after(async () => {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
});

test(
  'three active upload streams limit one account, reject a fourth and release its slot on abort',
  { timeout: 20000 },
  async () => {
    const a = await create();
    await db.query('DELETE FROM upload_events WHERE owner_id=$1', [ids.teacher]);
    const files = await Promise.all(Array.from({ length: 4 }, () => init(a)));
    const server = app.getHttpServer() as Server;
    assert.equal(server.listening, false);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const streams: ClientRequest[] = [];
    const unexpectedResponses: number[] = [];
    async function until(check: () => Promise<boolean>) {
      const start = Date.now();
      while (!(await check())) {
        assert.ok(Date.now() - start < 5000, 'Upload state did not settle within five seconds.');
        await delay(10);
      }
    }
    try {
      for (const file of files.slice(0, 3)) {
        const boundary = `upload-${randomUUID()}`;
        const stream = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            method: 'POST',
            path: `/api/assets/uploads/${file.id}/content`,
            headers: {
              Authorization: auth(),
              Connection: 'close',
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
          },
          (response) => {
            unexpectedResponses.push(response.statusCode ?? 0);
            response.resume();
          },
        );
        // Deliberate client aborts emit ECONNRESET. DB/file assertions below establish
        // the observable outcome rather than treating socket errors as success.
        stream.on('error', () => {});
        streams.push(stream);
        stream.write(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`,
        );
        stream.write(picture.subarray(0, 8));
      }
      await until(async () => {
        const [count] = await db.query(
          "SELECT count(*) AS n FROM assets WHERE owner_id=$1 AND status='UPLOADING' AND lease_until>clock_timestamp()",
          [ids.teacher],
        );
        const stored = await readdir(directory);
        return (
          Number(count!.n) === 3 &&
          files.slice(0, 3).every((file) => stored.some((key) => key.startsWith(file.id)))
        );
      });
      const rejected = await upload(files[3]!.id, picture).expect(429);
      assert.match(rejected.body.message, /three files/);
      const [waiting] = await db.query('SELECT status,lease_token FROM assets WHERE id=$1', [
        files[3]!.id,
      ]);
      assert.equal(waiting!.status, 'UPLOADING');
      assert.equal(waiting!.lease_token, null);

      // The active stream cap belongs to the account, not the API process.
      const other = (
        await http
          .post('/api/assignments')
          .set('Authorization', auth('other.teacher'))
          .send({
            schemaVersion: 2,
            classId: ids.otherClassroom,
            title: randomUUID(),
            description: '',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            questions: [response()],
          })
          .expect(201)
      ).body;
      const independent = await init(other, 'other.teacher');
      await upload(independent.id, picture, 'image.png', 'image/png', 'other.teacher').expect(201);
      assert.equal(await processed(independent.id), 'READY');
      assert.deepEqual(unexpectedResponses, []);

      streams[0]!.destroy();
      await until(
        async () =>
          (await db.query('SELECT status FROM assets WHERE id=$1', [files[0]!.id]))[0]!.status ===
          'FAILED',
      );
      assert.ok(!(await readdir(directory)).some((key) => key.startsWith(files[0]!.id)));
      await upload(files[3]!.id, picture).expect(201);
      assert.equal(await processed(files[3]!.id), 'READY');
    } finally {
      streams.forEach((stream) => stream.destroy());
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

test('real PNG upload remains PROCESSING until decoded; metadata is safe and draft media stays private', async () => {
  const a = await create(),
    input = {
      uploadRequestId: randomUUID(),
      assignmentId: a.id,
      questionId: a.questions[0].id,
      contentNodeId: randomUUID(),
      purpose: 'TEACHING',
      kind: 'image',
      name: 'teacher-secret.png',
      mime: 'image/png',
      bytes: picture.length,
    };
  const initialized = (
    await http.post('/api/assets/uploads').set('Authorization', auth()).send(input).expect(201)
  ).body;
  const replay = (
    await http.post('/api/assets/uploads').set('Authorization', auth()).send(input).expect(201)
  ).body;
  assert.equal(replay.id, initialized.id);
  await http
    .post('/api/assets/uploads')
    .set('Authorization', auth())
    .send({ ...input, name: 'changed.png' })
    .expect(409);
  const receipt = await upload(initialized.id, picture);
  assert.equal(receipt.status, 201);
  assert.equal(receipt.body.status, 'PROCESSING');
  await http.get(`/api/assets/${initialized.id}/content`).set('Authorization', auth()).expect(409);
  assert.equal(await processed(initialized.id), 'READY');
  const meta = (
    await http.get(`/api/assets/${initialized.id}`).set('Authorization', auth()).expect(200)
  ).body;
  assert.deepEqual([meta.width, meta.height, meta.mime], [64, 32, 'image/png']);
  assert.equal(meta.storageKey, undefined);
  assert.equal(meta.sha256, undefined);
  await http.get(`/api/assets/${initialized.id}`).expect(401);
  await http
    .get(`/api/assets/${initialized.id}`)
    .set('Authorization', auth('other.teacher'))
    .expect(404);
  await http
    .get(`/api/assets/${initialized.id}/content`)
    .set('Authorization', auth('student'))
    .expect(404);
  await http
    .head(`/api/assets/${initialized.id}/content?variant=thumbnail`)
    .set('Authorization', auth())
    .expect(200)
    .expect('Content-Type', /image\/png/);
});

test('shared published media is visible, teacher examples and transcripts never reach students; GET HEAD Range repeat authorization', async () => {
  const a = await create(),
    sharedNode = randomUUID(),
    exampleNode = randomUUID();
  const shared = await init(
    a,
    'teacher',
    'image',
    'answer-key-secret.png',
    'image/png',
    picture.length,
    sharedNode,
  );
  const example = await init(
    a,
    'teacher',
    'image',
    'reference.png',
    'image/png',
    picture.length,
    exampleNode,
  );
  await upload(shared.id, picture).expect(201);
  await upload(example.id, picture).expect(201);
  await processed(shared.id);
  await processed(example.id);
  await db.query("UPDATE assets SET transcript='teacher-only transcript' WHERE id=$1", [shared.id]);
  a.questions[0].prompt.push({
    id: sharedNode,
    type: 'image',
    assetId: shared.id,
    label: 'Picture',
    alt: 'A practice picture',
    caption: '',
  });
  a.questions[0].answerKey.referenceContent = [
    {
      id: exampleNode,
      type: 'image',
      assetId: example.id,
      label: 'Teacher example',
      alt: 'Teacher example',
      caption: '',
    },
  ];
  const updated = (
    await http
      .patch(`/api/assignments/${a.id}`)
      .set('Authorization', auth())
      .send({
        schemaVersion: 2,
        version: a.version,
        classId: a.classId,
        title: a.title,
        description: '',
        dueAt: a.dueAt,
        questions: a.questions,
      })
      .expect(200)
  ).body;
  await publish(updated);
  const student = (
    await http
      .get(`/api/assignments/${a.id}?schemaVersion=2`)
      .set('Authorization', auth('student'))
      .expect(200)
  ).body;
  assert.ok(!JSON.stringify(student).includes(example.id));
  const meta = (
    await http.get(`/api/assets/${shared.id}`).set('Authorization', auth('student')).expect(200)
  ).body;
  assert.equal(meta.originalName, undefined);
  assert.equal(meta.transcript, undefined);
  await http.get(`/api/assets/${example.id}`).set('Authorization', auth('student')).expect(404);
  await http
    .head(`/api/assets/${shared.id}/content`)
    .set('Authorization', auth('student'))
    .expect(200);
  await http
    .get(`/api/assets/${shared.id}/content`)
    .set('Authorization', auth('student'))
    .set('Range', 'bytes=0-7')
    .expect(206)
    .expect('Content-Length', '8')
    .expect('Cache-Control', 'private, no-store');
  await http
    .get(`/api/assets/${shared.id}/content`)
    .set('Authorization', auth('student'))
    .set('Range', 'bytes=999999-')
    .expect(416);
  await http
    .get(`/api/assets/${shared.id}/content?variant=original`)
    .set('Authorization', auth('student'))
    .expect(403);
  await http
    .get(`/api/assets/${shared.id}/content?variant=original`)
    .set('Authorization', auth())
    .expect(200)
    .expect('Content-Disposition', /attachment/);
  await db.query(
    'UPDATE assignment_recipients SET removed_at=clock_timestamp() WHERE assignment_id=$1 AND student_id=$2',
    [a.id, ids.student],
  );
  for (const method of ['get', 'head'] as const)
    await http[method](`/api/assets/${shared.id}/content`)
      .set('Authorization', auth('student'))
      .set('Range', 'bytes=0-7')
      .expect(404);
  await http.get(`/api/assets/${shared.id}/content`).set('Authorization', auth()).expect(200);
  await http.delete(`/api/assets/${shared.id}`).set('Authorization', auth()).expect(409);
});

test('real PCM WAV is fully decoded and transcoded to playable MP3; a student original becomes visible only after submission', async () => {
  const a = await publish(await create()),
    data = wav();
  const file = await init(a, 'student', 'audio', 'reading.wav', 'audio/wav', data.length);
  await upload(file.id, data, 'reading.wav', 'audio/wav', 'student').expect(201);
  assert.equal(await processed(file.id), 'READY');
  const meta = (
    await http.get(`/api/assets/${file.id}`).set('Authorization', auth('student')).expect(200)
  ).body;
  assert.equal(meta.mime, 'audio/mpeg');
  assert.ok(meta.durationSeconds > 0 && meta.durationSeconds < 2);
  await http
    .get(`/api/assets/${file.id}/content`)
    .set('Authorization', auth('student'))
    .set('Range', 'bytes=-16')
    .expect(206)
    .expect('Content-Length', '16');
  await http.get(`/api/assets/${file.id}`).set('Authorization', auth('teacher')).expect(404);
  await http.get(`/api/assets/${file.id}`).set('Authorization', auth('other.student')).expect(404);
  await http
    .patch(`/api/assets/${file.id}`)
    .set('Authorization', auth('student'))
    .send({ caption: 'My oral reading' })
    .expect(200);
  await http
    .patch(`/api/assets/${file.id}`)
    .set('Authorization', auth('other.student'))
    .send({ caption: 'Intrusion' })
    .expect(404);
  const submission = await http
    .post(`/api/assignments/${a.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({
      schemaVersion: 2,
      publishedVersion: a.publishedVersion,
      requestId: randomUUID(),
      answers: [
        {
          questionId: a.questions[0].id,
          type: 'RESPONSE',
          payload: { text: 'My reading', assetIds: [file.id] },
          evidenceAssetIds: [],
        },
      ],
    })
    .expect(201);
  assert.equal(submission.body.gradingStatus, 'PENDING_REVIEW');
  const described = await http
    .get(`/api/assets/${file.id}`)
    .set('Authorization', auth())
    .expect(200);
  assert.equal(described.body.caption, 'My oral reading');
  await http
    .patch(`/api/assets/${file.id}`)
    .set('Authorization', auth('student'))
    .send({ caption: 'Changed after submission' })
    .expect(409);
  await http
    .get(`/api/assets/${file.id}/content?variant=original`)
    .set('Authorization', auth())
    .expect(200)
    .expect('Content-Type', /audio\/wav/);
  await http.delete(`/api/assets/${file.id}`).set('Authorization', auth('student')).expect(409);
  await db.query("UPDATE assets SET created_at=clock_timestamp()-interval '30 days' WHERE id=$1", [
    file.id,
  ]);
  await assets.cleanup();
  await http.get(`/api/assets/${file.id}/content`).set('Authorization', auth()).expect(200);
});

test('wrong signatures, corrupt images, invalid types and actual-size mismatches never become READY or retain quota', async () => {
  const a = await create();
  for (const [name, mime] of [
    ['test.svg', 'image/svg+xml'],
    ['test.heic', 'image/heic'],
    ['test.png', 'image/jpeg'],
  ])
    await http
      .post('/api/assets/uploads')
      .set('Authorization', auth())
      .send({
        uploadRequestId: randomUUID(),
        assignmentId: a.id,
        questionId: a.questions[0].id,
        contentNodeId: randomUUID(),
        purpose: 'TEACHING',
        kind: 'image',
        name,
        mime,
        bytes: 100,
      })
      .expect(415);
  const fake = await init(a, 'teacher', 'image', 'fake.png', 'image/png', 8);
  await upload(fake.id, Buffer.from('not png!')).expect(201);
  assert.equal(await processed(fake.id), 'FAILED');
  const corrupt = await init(a, 'teacher', 'image', 'corrupt.png', 'image/png', 8);
  await upload(corrupt.id, picture.subarray(0, 8)).expect(201);
  assert.equal(await processed(corrupt.id), 'FAILED');
  const tooBig = await init(a, 'teacher', 'image', 'big.png', 'image/png', picture.length - 1);
  await upload(tooBig.id, picture).expect(413);
  const tooSmall = await init(a, 'teacher', 'image', 'short.png', 'image/png', picture.length + 1);
  await upload(tooSmall.id, picture).expect(400);
  for (const id of [fake.id, corrupt.id, tooBig.id, tooSmall.id]) {
    const [row] = await db.query('SELECT status FROM assets WHERE id=$1', [id]);
    assert.equal(row?.status, 'FAILED');
    await http.get(`/api/assets/${id}/content`).set('Authorization', auth()).expect(409);
  }
});

test('image orientation is corrected, metadata stripped and animated WebP rejected by real decoder', async () => {
  const a = await create();
  const rotated = await sharp({
    create: { width: 10, height: 20, channels: 3, background: 'white' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const asset = await init(a, 'teacher', 'image', 'rotated.jpg', 'image/jpeg', rotated.length);
  await upload(asset.id, rotated, 'rotated.jpg', 'image/jpeg').expect(201);
  assert.equal(await processed(asset.id), 'READY');
  const [row] = await db.query('SELECT display_key FROM assets WHERE id=$1', [asset.id]);
  const meta = await sharp(await readFile(assets.path(String(row!.display_key)))).metadata();
  assert.deepEqual([meta.width, meta.height], [20, 10]);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  const pixels = Buffer.alloc(2 * 2 * 3 * 2, 128);
  pixels.fill(255, pixels.length / 2);
  const animated = await sharp(pixels, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  const motion = await init(a, 'teacher', 'image', 'motion.webp', 'image/webp', animated.length);
  await upload(motion.id, animated, 'motion.webp', 'image/webp').expect(201);
  assert.equal(await processed(motion.id), 'FAILED');
});

test('MP3 and AAC-LC M4A inputs use the same safe output path; non-PCM WAV is rejected', async () => {
  const a = await create(),
    source = join(directory, 'sample.wav');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(source, wav());
  for (const [name, mime, codec] of [
    ['sample.mp3', 'audio/mpeg', 'libmp3lame'],
    ['sample.m4a', 'audio/mp4', 'aac'],
    ['sample-compressed.wav', 'audio/wav', 'adpcm_ima_wav'],
  ]) {
    const path = join(directory, name!);
    await promisify(execFile)(process.env.FFMPEG_PATH ?? 'ffmpeg', [
      '-v',
      'error',
      '-nostdin',
      '-i',
      source,
      '-c:a',
      codec!,
      '-y',
      path,
    ]);
    const data = await readFile(path),
      file = await init(a, 'teacher', 'audio', name, mime, data.length);
    await upload(file.id, data, name, mime).expect(201);
    assert.equal(
      await processed(file.id),
      codec === 'adpcm_ima_wav' || codec === 'alac' ? 'FAILED' : 'READY',
    );
  }
});

test('workspace reservations and upload event limits are shared and atomic; duplicate declarations do not count twice', async () => {
  const a = await publish(await create());
  await db.query('DELETE FROM upload_events WHERE owner_id=$1', [ids.student]);
  const declarations = await Promise.all(
    Array.from({ length: 5 }, () =>
      http
        .post('/api/assets/uploads')
        .set('Authorization', auth('student'))
        .send({
          uploadRequestId: randomUUID(),
          assignmentId: a.id,
          questionId: a.questions[0].id,
          contentNodeId: null,
          purpose: 'ANSWER',
          kind: 'audio',
          name: 'reading.mp3',
          mime: 'audio/mpeg',
          bytes: 50 * 1048576,
        }),
    ),
  );
  assert.deepEqual(declarations.map((r) => r.status).sort(), [201, 201, 201, 201, 413]);
  const first = declarations.find((r) => r.status === 201)!.body;
  await http.delete(`/api/assets/${first.id}`).set('Authorization', auth('student')).expect(200);
  await init(a, 'student', 'audio', 'replacement.mp3', 'audio/mpeg', 50 * 1048576);
  await db.query('DELETE FROM upload_events WHERE owner_id=$1', [ids.teacher]);
  for (let i = 0; i < 30; i++)
    await db.query('INSERT INTO upload_events(owner_id,upload_id) VALUES ($1,$2)', [
      ids.teacher,
      randomUUID(),
    ]);
  const own = await create();
  await http
    .post('/api/assets/uploads')
    .set('Authorization', auth())
    .send({
      uploadRequestId: randomUUID(),
      assignmentId: own.id,
      questionId: own.questions[0].id,
      contentNodeId: randomUUID(),
      purpose: 'TEACHING',
      kind: 'image',
      name: 'limit.png',
      mime: 'image/png',
      bytes: picture.length,
    })
    .expect(429);
  await db.query('DELETE FROM upload_events WHERE owner_id=$1', [ids.teacher]);
});

test('cleanup respects saved references and the undo period, reclaims old unbound files, and processing cannot resurrect cancellation', async () => {
  const a = await create(),
    node = randomUUID();
  const bound = await init(a, 'teacher', 'image', 'bound.png', 'image/png', picture.length, node);
  await upload(bound.id, picture).expect(201);
  await processed(bound.id);
  a.questions[0].answerAreaContent = [
    { id: node, type: 'image', assetId: bound.id, label: 'Image', alt: 'Image', caption: '' },
  ];
  const updated = (
    await http
      .patch(`/api/assignments/${a.id}`)
      .set('Authorization', auth())
      .send({
        schemaVersion: 2,
        version: a.version,
        classId: a.classId,
        title: a.title,
        description: '',
        dueAt: a.dueAt,
        questions: a.questions,
      })
      .expect(200)
  ).body;
  await db.query("UPDATE assets SET created_at=clock_timestamp()-interval '30 days' WHERE id=$1", [
    bound.id,
  ]);
  await assets.cleanup();
  await http.get(`/api/assets/${bound.id}/content`).set('Authorization', auth()).expect(200);
  const retained = structuredClone(updated.questions[0].answerAreaContent[0]);
  updated.questions[0].answerAreaContent = [];
  const save = async (questions: QuestionV2[], version: number) =>
    (
      await http
        .patch(`/api/assignments/${a.id}`)
        .set('Authorization', auth())
        .send({
          schemaVersion: 2,
          version,
          classId: a.classId,
          title: a.title,
          description: '',
          dueAt: a.dueAt,
          questions,
        })
        .expect(200)
    ).body;
  let saved = await save(updated.questions, updated.version);
  await assets.cleanup();
  await http.get(`/api/assets/${bound.id}/content`).set('Authorization', auth()).expect(200);
  // Undo within the grace period and share the same immutable file in two blocks.
  saved.questions[0].answerAreaContent = [retained, { ...retained, id: randomUUID() }];
  saved = await save(saved.questions, saved.version);
  assert.equal(
    (await db.query('SELECT 1 FROM asset_references WHERE asset_id=$1', [bound.id])).length,
    2,
  );
  saved.questions[0].answerAreaContent.splice(0, 1);
  saved = await save(saved.questions, saved.version);
  await assets.cleanup();
  await http.get(`/api/assets/${bound.id}/content`).set('Authorization', auth()).expect(200);
  assert.equal(
    (await db.query('SELECT 1 FROM asset_references WHERE asset_id=$1', [bound.id])).length,
    1,
  );
  saved.questions[0].answerAreaContent = [];
  await save(saved.questions, saved.version);
  await db.query("UPDATE assets SET detached_at=clock_timestamp()-interval '8 days' WHERE id=$1", [
    bound.id,
  ]);
  await assets.cleanup();
  await http.get(`/api/assets/${bound.id}`).set('Authorization', auth()).expect(404);
  const cancelled = await init(a);
  await upload(cancelled.id, picture).expect(201);
  await http.delete(`/api/assets/${cancelled.id}`).set('Authorization', auth()).expect(200);
  assert.equal(await processed(cancelled.id), 'DELETED');
  assert.ok(!(await readdir(directory)).some((name) => name.startsWith(cancelled.id)));
});

test('byte range parser preserves HTTP suffix and bounded semantics', () => {
  assert.deepEqual(byteRange('bytes=5-', 10), { start: 5, end: 9 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange('bytes=0-999', 10), { start: 0, end: 9 });
  for (const value of [
    'bytes=10-',
    'bytes=-0',
    'bytes=2-1',
    'bytes=0-1,3-4',
    'bytes=-',
    'bytes=999999999999999999999-',
  ])
    assert.equal(byteRange(value, 10), false);
});
test('decoded audio accepts exactly 600 seconds despite encoder padding and rejects longer content', async () => {
  const a = await create();
  for (const seconds of [600, 600.1]) {
    const data = wav(seconds),
      file = await init(a, 'teacher', 'audio', 'boundary.wav', 'audio/wav', data.length);
    await upload(file.id, data, 'boundary.wav', 'audio/wav').expect(201);
    assert.equal(await processed(file.id), seconds === 600 ? 'READY' : 'FAILED');
    const [row] = await db.query('SELECT duration_seconds,error_code FROM assets WHERE id=$1', [
      file.id,
    ]);
    if (seconds === 600) assert.equal(Number(row!.duration_seconds), 600);
    else assert.equal(row!.error_code, 'AUDIO_DURATION_LIMIT');
  }
});

test('real image dimension and decoded-pixel limits reject compressed oversized images', async () => {
  await db.query('DELETE FROM upload_events WHERE owner_id=$1', [ids.teacher]);
  const a = await create();
  for (const [width, height] of [
    [10001, 1],
    [4500, 4500],
  ]) {
    const data = await sharp({
      create: { width: width!, height: height!, channels: 3, background: '#225588' },
    })
      .png()
      .toBuffer();
    assert.ok(data.length < 10 * 1048576);
    const file = await init(a, 'teacher', 'image', 'large.png', 'image/png', data.length);
    await upload(file.id, data, 'large.png').expect(201);
    assert.equal(await processed(file.id), 'FAILED');
    const [row] = await db.query('SELECT display_key FROM assets WHERE id=$1', [file.id]);
    assert.equal(row!.display_key, null);
  }
});
test('genuine image and audio at the byte limits decode; one-byte-over declarations return 413 without quota reservations', async () => {
  const a = await create();
  // Add a valid private ancillary PNG chunk before IEND. It is ignored by the
  // decoder and removed from the safe output, while the input is exactly 10 MiB.
  const chunk = Buffer.alloc(mediaLimits.imageBytes - picture.length);
  chunk.writeUInt32BE(chunk.length - 12, 0);
  chunk.write('npAD', 4);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  const image = Buffer.concat([picture.subarray(0, -12), chunk, picture.subarray(-12)]);
  const audio = Buffer.alloc(mediaLimits.audioBytes);
  wav(0).copy(audio);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.writeUInt32LE(44100, 24);
  audio.writeUInt32LE(88200, 28);
  audio.writeUInt32LE(audio.length - 44, 40);
  for (const [kind, name, mime, data] of [
    ['image', 'limit.png', 'image/png', image],
    ['audio', 'limit.wav', 'audio/wav', audio],
  ] as const) {
    const asset = await init(a, 'teacher', kind, name, mime, data.length);
    await upload(asset.id, data, name, mime).expect(201);
    assert.equal(await processed(asset.id), 'READY');
    const requestId = randomUUID();
    const eventsBefore = await db.query(
      'SELECT upload_id FROM upload_events WHERE owner_id=$1 ORDER BY upload_id',
      [ids.teacher],
    );
    await http
      .post('/api/assets/uploads')
      .set('Authorization', auth())
      .send({
        uploadRequestId: requestId,
        assignmentId: a.id,
        questionId: a.questions[0].id,
        contentNodeId: randomUUID(),
        purpose: 'TEACHING',
        kind,
        name,
        mime,
        bytes: data.length + 1,
      })
      .expect(413);
    assert.equal(
      (await db.query('SELECT id FROM assets WHERE upload_request_id=$1', [requestId])).length,
      0,
    );
    assert.deepEqual(
      await db.query('SELECT upload_id FROM upload_events WHERE owner_id=$1 ORDER BY upload_id', [
        ids.teacher,
      ]),
      eventsBefore,
    );
  }
});
test('a persisted processing lease survives a worker restart and only resumes after expiry', async () => {
  const a = await create(),
    file = await init(a);
  await upload(file.id, picture).expect(201);
  await db.query(
    "UPDATE assets SET attempts=1,lease_token=$2,lease_until=clock_timestamp()+interval '1 minute' WHERE id=$1",
    [file.id, randomUUID()],
  );
  // A new service instance represents a replacement worker, sharing persistent DB state.
  const replacement = new AssetsService(
    db,
    app.get((await import('../src/assignments/assignments.service.js')).AssignmentsService),
  );
  assert.equal(await replacement.processNext(), false);
  await db.query(
    "UPDATE assets SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [file.id],
  );
  assert.equal(await replacement.processNext(), true);
  const [row] = await db.query('SELECT status,attempts,lease_token FROM assets WHERE id=$1', [
    file.id,
  ]);
  assert.equal(row!.status, 'READY');
  assert.equal(row!.attempts, 2);
  assert.equal(row!.lease_token, null);
  await replacement.onModuleDestroy();
});
test('cleanup racing a draft resource binding either preserves the complete file or rejects the atomic edit', async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = await create(),
      nodeId = randomUUID(),
      file = await init(a, 'teacher', 'image', 'image.png', 'image/png', picture.length, nodeId);
    await upload(file.id, picture).expect(201);
    assert.equal(await processed(file.id), 'READY');
    await db.query(
      "UPDATE assets SET created_at=clock_timestamp()-interval '25 hours' WHERE id=$1",
      [file.id],
    );
    const question = {
      ...a.questions[0],
      prompt: [
        ...a.questions[0].prompt,
        {
          id: nodeId,
          type: 'image',
          assetId: file.id,
          label: 'Picture',
          alt: 'Blue rectangle',
          caption: '',
        },
      ],
    };
    const [edit] = await Promise.all([
      http
        .patch(`/api/assignments/${a.id}`)
        .set('Authorization', auth())
        .send({
          schemaVersion: 2,
          classId: a.classId,
          title: a.title,
          description: a.description,
          dueAt: a.dueAt,
          version: a.version,
          questions: [question],
        }),
      assets.cleanup(),
    ]);
    const [state] = await db.query('SELECT status FROM assets WHERE id=$1', [file.id]);
    const refs = await db.query('SELECT 1 FROM asset_references WHERE asset_id=$1', [file.id]);
    if (edit.status === 200) {
      assert.equal(state!.status, 'READY');
      assert.equal(refs.length, 1);
      await http.get(`/api/assets/${file.id}/content`).set('Authorization', auth()).expect(200);
    } else {
      assert.ok([400, 409].includes(edit.status), `Unexpected edit status ${edit.status}`);
      assert.equal(state!.status, 'DELETED');
      assert.equal(refs.length, 0);
      const detail = await http
        .get(`/api/assignments/${a.id}?schemaVersion=2`)
        .set('Authorization', auth())
        .expect(200);
      assert.equal(detail.body.version, a.version);
      assert.equal(detail.body.questions[0].prompt.length, a.questions[0].prompt.length);
    }
  }
});

test('cleanup alongside publication and final submission preserves teaching and submitted media', async () => {
  const a = await create(),
    node = randomUUID();
  const teaching = await init(
    a,
    'teacher',
    'image',
    'image.png',
    'image/png',
    picture.length,
    node,
  );
  await upload(teaching.id, picture).expect(201);
  assert.equal(await processed(teaching.id), 'READY');
  a.questions[0].prompt.push({
    id: node,
    type: 'image',
    assetId: teaching.id,
    label: 'Picture',
    alt: 'Rectangle',
    caption: '',
  });
  const saved = (
    await http
      .patch(`/api/assignments/${a.id}`)
      .set('Authorization', auth())
      .send({
        schemaVersion: 2,
        classId: a.classId,
        title: a.title,
        description: '',
        dueAt: a.dueAt,
        questions: a.questions,
        version: a.version,
      })
      .expect(200)
  ).body;
  await db.query("UPDATE assets SET created_at=clock_timestamp()-interval '30 days' WHERE id=$1", [
    teaching.id,
  ]);
  const [published] = await Promise.all([publish(saved), assets.cleanup()]);
  await http
    .get(`/api/assets/${teaching.id}/content`)
    .set('Authorization', auth('student'))
    .expect(200);
  const audio = wav(),
    answer = await init(published, 'student', 'audio', 'reading.wav', 'audio/wav', audio.length);
  await upload(answer.id, audio, 'reading.wav', 'audio/wav', 'student').expect(201);
  assert.equal(await processed(answer.id), 'READY');
  // Old creation time alone does not make an answer eligible before dueAt+7d.
  await db.query("UPDATE assets SET created_at=clock_timestamp()-interval '30 days' WHERE id=$1", [
    answer.id,
  ]);
  const [submission] = await Promise.all([
    http
      .post(`/api/assignments/${a.id}/submissions`)
      .set('Authorization', auth('student'))
      .send({
        schemaVersion: 2,
        publishedVersion: published.publishedVersion,
        requestId: randomUUID(),
        answers: [
          {
            questionId: a.questions[0].id,
            type: 'RESPONSE',
            payload: { text: 'A bird flies.', assetIds: [answer.id] },
            evidenceAssetIds: [],
          },
        ],
      })
      .expect(201),
    assets.cleanup(),
  ]);
  const [binding] = await db.query('SELECT reference_id FROM asset_references WHERE asset_id=$1', [
    answer.id,
  ]);
  assert.equal(binding!.reference_id, submission.body.id);
  await db.query("UPDATE assignments SET due_at=clock_timestamp()-interval '8 days' WHERE id=$1", [
    a.id,
  ]);
  await assets.cleanup();
  await http
    .get(`/api/assets/${answer.id}/content`)
    .set('Authorization', auth('student'))
    .expect(200);
  await http
    .get(`/api/assets/${answer.id}/content?variant=original`)
    .set('Authorization', auth())
    .expect(200);
});
