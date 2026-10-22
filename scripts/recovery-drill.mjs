import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import supertest from 'supertest';
import sharp from 'sharp';
import { questionV2Schema } from '@amp/contracts';
import { AssetsService } from '../apps/api/dist/assets/assets.service.js';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database/database.js';
import { migrate } from '../apps/api/dist/database/migrate.js';
import { ids, seed } from '../apps/api/dist/database/seed.js';

// This drill creates its own fixture databases. It never opens .local/database or
// a database from .env. Copy only after the source app has shut down cleanly.
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, '.local'), { recursive: true });
const directory = await mkdtemp(path.join(root, '.local/recovery-drill-'));
const source = path.join(directory, 'source');
const backup = path.join(directory, 'backup');
const restored = path.join(directory, 'restored');
process.env.NODE_ENV = 'test';
process.env.SERVE_WEB = 'false';
process.env.DATABASE_DRIVER = 'pglite';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'RecoveryFixture123!';

async function open(dataDirectory) {
  process.env.DATABASE_URL = dataDirectory;
  process.env.ASSET_DIRECTORY = `${dataDirectory}-assets`;
  return createApp(true);
}
async function login(http, role) {
  return (
    await http
      .post('/api/auth/login')
      .send({
        email: `${role}@example.test`,
        password: process.env.DEMO_PASSWORD,
      })
      .expect(201)
  ).body.token;
}
const tables = [
  'schema_migrations',
  'users',
  'classrooms',
  'class_memberships',
  'assignments',
  'questions',
  'assignment_recipients',
  'submissions',
  'invitations',
  'sessions',
  'grading_drafts',
  'grading_revisions',
  'assets',
  'asset_references',
  'upload_events',
];
async function snapshot(db) {
  const result = {};
  for (const table of tables) {
    // Identifiers come only from the constant allowlist above.
    const rows = await db.query(
      `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
    );
    result[table] = {
      count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    };
  }
  return result;
}
async function fileManifest(directory) {
  const paths = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  return Promise.all(
    paths.map(async (file) => {
      const bytes = await readFile(file);
      return {
        key: path.relative(directory, file),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
}
function recording() {
  const b = Buffer.alloc(16044);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(16000, 40);
  return b;
}
let app;
try {
  app = await open(source);
  let db = app.get(Database);
  await migrate(db);
  await seed(db);
  let http = supertest(app.getHttpServer());
  const teacher = await login(http, 'teacher');
  const student = await login(http, 'student');
  const assignment = (
    await http
      .post('/api/assignments')
      .set('Authorization', `Bearer ${teacher}`)
      .send({
        classId: ids.classroom,
        title: 'Recovery fixture',
        description: 'Synthetic data only.',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        questions: [
          {
            prompt: 'Select the first option.',
            options: ['First', 'Second'],
            correctIndex: 0,
            points: 10,
          },
        ],
      })
      .expect(201)
  ).body;
  await http
    .post(`/api/assignments/${assignment.id}/publish`)
    .set('Authorization', `Bearer ${teacher}`)
    .send({ version: assignment.version })
    .expect(201);
  const submission = (
    await http
      .post(`/api/assignments/${assignment.id}/submissions`)
      .set('Authorization', `Bearer ${student}`)
      .send({
        requestId: randomUUID(),
        answers: [{ questionId: assignment.questions[0].id, selectedIndex: 0 }],
      })
      .expect(201)
  ).body;
  const invitation = (
    await http
      .post(`/api/classes/${ids.classroom}/invitations`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({})
      .expect(201)
  ).body;
  const dimensionId = randomUUID(),
    questionId = randomUUID();
  const question = questionV2Schema.parse({
    id: questionId,
    parentId: null,
    position: 0,
    type: 'RESPONSE',
    prompt: [
      {
        id: randomUUID(),
        type: 'paragraph',
        children: [{ type: 'text', text: 'Describe the picture and read your response aloud.' }],
      },
    ],
    answerAreaContent: [],
    points: 2,
    config: {
      textEnabled: true,
      textRequired: true,
      minImages: 0,
      maxImages: 0,
      minAudios: 1,
      maxAudios: 1,
      rubric: [
        {
          id: dimensionId,
          name: 'Meaning and pronunciation',
          description: 'Clear meaning and understandable pronunciation.',
          points: 2,
        },
      ],
    },
    answerKey: { referenceText: 'Private exemplar' },
  });
  const mixed = (
    await http
      .post('/api/assignments')
      .set('Authorization', `Bearer ${teacher}`)
      .send({
        schemaVersion: 2,
        classId: ids.classroom,
        title: 'Media recovery fixture',
        description: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        questions: [question],
      })
      .expect(201)
  ).body;
  const processor = app.get(AssetsService);
  async function media(roleToken, purpose, kind, name, mime, data, nodeId = null) {
    const file = (
      await http
        .post('/api/assets/uploads')
        .set('Authorization', `Bearer ${roleToken}`)
        .send({
          uploadRequestId: randomUUID(),
          assignmentId: mixed.id,
          questionId,
          contentNodeId: nodeId,
          purpose,
          kind,
          name,
          mime,
          bytes: data.length,
        })
        .expect(201)
    ).body;
    await http
      .post(`/api/assets/uploads/${file.id}/content`)
      .set('Authorization', `Bearer ${roleToken}`)
      .attach('file', data, { filename: name, contentType: mime })
      .expect(201);
    for (let n = 0; n < 10; n++) {
      const meta = (
        await http
          .get(`/api/assets/${file.id}`)
          .set('Authorization', `Bearer ${roleToken}`)
          .expect(200)
      ).body;
      if (meta.status === 'READY') return meta;
      assert.equal(meta.status, 'PROCESSING');
      await processor.processNext();
    }
    throw new Error('Recovery fixture media did not become READY.');
  }
  const picture = await sharp({
    create: { width: 64, height: 32, channels: 3, background: '#225588' },
  })
    .png()
    .toBuffer();
  const nodeId = randomUUID();
  const teaching = await media(
    teacher,
    'TEACHING',
    'image',
    'recovery.png',
    'image/png',
    picture,
    nodeId,
  );
  question.prompt.push({
    id: nodeId,
    type: 'image',
    assetId: teaching.id,
    label: 'Observe the picture',
    alt: 'A simple blue rectangle',
    caption: '',
  });
  const edited = (
    await http
      .patch(`/api/assignments/${mixed.id}`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({
        schemaVersion: 2,
        classId: ids.classroom,
        title: mixed.title,
        description: '',
        dueAt: mixed.dueAt,
        version: mixed.version,
        questions: [question],
      })
      .expect(200)
  ).body;
  const published = (
    await http
      .post(`/api/assignments/${mixed.id}/publish`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({ schemaVersion: 2, version: edited.version })
      .expect(201)
  ).body;
  const rawAudio = recording();
  const answerAudio = await media(student, 'ANSWER', 'audio', 'reading.wav', 'audio/wav', rawAudio);
  await http
    .patch(`/api/assets/${answerAudio.id}`)
    .set('Authorization', `Bearer ${student}`)
    .send({ caption: 'My reading' })
    .expect(200);
  const manualSubmission = (
    await http
      .post(`/api/assignments/${mixed.id}/submissions`)
      .set('Authorization', `Bearer ${student}`)
      .send({
        schemaVersion: 2,
        publishedVersion: published.publishedVersion,
        requestId: randomUUID(),
        answers: [
          {
            questionId,
            type: 'RESPONSE',
            payload: { text: 'My spoken response', assetIds: [answerAudio.id] },
            evidenceAssetIds: [],
          },
        ],
      })
      .expect(201)
  ).body;
  const savedGrade = (
    await http
      .patch(`/api/submissions/${manualSubmission.id}/grading`)
      .set('Authorization', `Bearer ${teacher}`)
      .send({
        gradingVersion: manualSubmission.gradingVersion,
        answers: [{ questionId, dimensions: [{ dimensionId, score: 2 }], feedback: 'Well done.' }],
      })
      .expect(200)
  ).body;
  await http
    .post(`/api/submissions/${manualSubmission.id}/grading/publish`)
    .set('Authorization', `Bearer ${teacher}`)
    .send({ gradingVersion: savedGrade.gradingVersion, requestId: randomUUID(), reason: '' })
    .expect(201);
  const before = await snapshot(db);
  const beforeFiles = await fileManifest(`${source}-assets`);
  assert.ok(beforeFiles.length >= 5, 'Originals and safe derived files must exist.');
  await app.close();
  app = undefined;
  const backupStarted = performance.now();
  await cp(source, backup, { recursive: true, errorOnExist: true, force: false });
  await cp(`${source}-assets`, `${backup}-assets`, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  assert.deepEqual(await fileManifest(`${backup}-assets`), beforeFiles);
  const backupMs = performance.now() - backupStarted;
  const restoreStarted = performance.now();
  await cp(backup, restored, { recursive: true, errorOnExist: true, force: false });
  await cp(`${backup}-assets`, `${restored}-assets`, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  assert.deepEqual(await fileManifest(`${restored}-assets`), beforeFiles);
  app = await open(restored);
  db = app.get(Database);
  await migrate(db);
  const after = await snapshot(db);
  assert.deepEqual(
    after,
    before,
    'All table data and migration checksums must survive restoration.',
  );
  const restoreMs = performance.now() - restoreStarted;

  // Revoke credentials copied from the backup before accepting restored traffic.
  await db.transaction(async (tx) => {
    await tx.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL');
    await tx.query('UPDATE invitations SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL');
  });
  http = supertest(app.getHttpServer());
  await http.get('/api/auth/me').set('Authorization', `Bearer ${teacher}`).expect(401);
  await http.get('/api/auth/me').set('Authorization', `Bearer ${student}`).expect(401);
  const newStudent = await login(http, 'student');
  const newTeacher = await login(http, 'teacher');
  const detail = await http
    .get(`/api/assignments/${assignment.id}`)
    .set('Authorization', `Bearer ${newStudent}`)
    .expect(200);
  assert.deepEqual(detail.body.submission, submission);
  assert.ok(detail.body.questions.every((q) => !('correctIndex' in q)));
  const stats = await http
    .get(`/api/assignments/${assignment.id}/stats`)
    .set('Authorization', `Bearer ${newTeacher}`)
    .expect(200);
  assert.deepEqual(stats.body, { enrolled: 1, submitted: 1, averagePercent: 100 });
  const roster = await http
    .get(`/api/assignments/${assignment.id}/submissions`)
    .set('Authorization', `Bearer ${newTeacher}`)
    .expect(200);
  assert.equal(roster.body.items[0].submission.id, submission.id);
  await http
    .post('/api/classes/join')
    .set('Authorization', `Bearer ${newStudent}`)
    .send({ invitation: invitation.token })
    .expect(400);
  const restoredManual = (
    await http
      .get(`/api/assignments/${mixed.id}?schemaVersion=2`)
      .set('Authorization', `Bearer ${newStudent}`)
      .expect(200)
  ).body;
  assert.equal(restoredManual.submission.score, 2);
  assert.equal(restoredManual.submission.gradingStatus, 'GRADED');
  assert.ok(!JSON.stringify(restoredManual).includes('Private exemplar'));
  await http
    .get(`/api/assets/${teaching.id}/content`)
    .set('Authorization', `Bearer ${newStudent}`)
    .expect(200);
  const original = await http
    .get(`/api/assets/${answerAudio.id}/content?variant=original`)
    .set('Authorization', `Bearer ${newTeacher}`)
    .expect(200);
  assert.deepEqual(original.body, rawAudio);
  await http
    .get(`/api/assets/${answerAudio.id}/content`)
    .set('Authorization', `Bearer ${newStudent}`)
    .set('Range', 'bytes=0-15')
    .expect(206);
  const restoredReview = (
    await http
      .get(`/api/assignments/${mixed.id}/submissions/${manualSubmission.id}`)
      .set('Authorization', `Bearer ${newTeacher}`)
      .expect(200)
  ).body;
  assert.equal(restoredReview.gradingRevisions.length, 1);
  assert.equal(restoredReview.gradingRevisions[0].score, 2);
  const pglite = JSON.parse(
    await readFile(path.join(root, 'node_modules/@electric-sql/pglite/package.json'), 'utf8'),
  ).version;
  const evidence = {
    verifiedAt: new Date().toISOString(),
    node: process.version,
    pglite,
    method:
      'Offline directory copy after clean shutdown; restore to a separate, previously absent directory with the same PGlite version.',
    scope:
      'Synthetic local PGlite fixture only. Does not establish PostgreSQL pg_dump recovery, cross-version compatibility or production disaster recovery.',
    fixtureDirectory: path.relative(root, directory),
    backupMs: Math.round(backupMs),
    restoreAndVerifyMs: Math.round(restoreMs),
    tables: before,
    mediaManifest: beforeFiles,
    assertions: [
      'All fifteen table counts and SHA-256 logical data digests match',
      'Original and derived media manifests match SHA-256 after backup and restore',
      'Restored student media playback, teacher originals and grading revisions remain readable',
      'Applied migrations remain valid',
      'Restored sessions and invitations revoked',
      'Teacher and student can sign in again',
      'Student result and teacher report preserve submission ID and score',
      'Student answer keys remain hidden',
    ],
  };
  await mkdir(path.join(root, 'docs/evidence'), { recursive: true });
  await writeFile(
    path.join(root, 'docs/evidence/recovery.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `Local recovery passed: ${tables.length} tables preserved; credentials revoked; teacher/student results verified. Synthetic fixture: ${evidence.fixtureDirectory}`,
  );
} finally {
  await app?.close();
}
