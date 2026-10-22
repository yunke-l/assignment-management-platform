import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import {
  questionV2Schema,
  type QuestionV2,
  type Content,
  type ChoiceV2,
  type AnswerV2,
} from '@amp/contracts';
import { createApp } from '../src/app.js';
import { Database } from '../src/database/database.js';
import { migrate } from '../src/database/migrate.js';
import { ids, seed } from '../src/database/seed.js';

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'TestPassword123!';
process.env.DATABASE_DRIVER = process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'memory://';
let app: Awaited<ReturnType<typeof createApp>>, db: Database, http: ReturnType<typeof supertest>;
const tokens: Record<string, string> = {};
const auth = (role = 'teacher') => `Bearer ${tokens[role]}`;
const text = (value: string): Content => [
  { id: randomUUID(), type: 'paragraph', children: [{ type: 'text', text: value }] },
];
const choice = (label: string): ChoiceV2 => ({ id: randomUUID(), label, content: text(label) });
function make<T extends QuestionV2['type']>(
  type: T,
  config: unknown,
  answerKey: unknown,
  points: number,
  position: number,
): Extract<QuestionV2, { type: T }> {
  return questionV2Schema.parse({
    id: randomUUID(),
    parentId: null,
    position,
    prompt: text('Complete this English task.'),
    answerAreaContent: [],
    evidenceEnabled: false,
    explanation: '',
    type,
    points,
    config,
    answerKey,
  }) as Extract<QuestionV2, { type: T }>;
}
function fixture() {
  const blanks = [
    { id: randomUUID(), points: 2 },
    { id: randomUUID(), points: 3 },
  ];
  const fill = make(
    'FILL_BLANK',
    { blanks },
    {
      answers: [
        { blankId: blanks[0]!.id, values: ['London'] },
        { blankId: blanks[1]!.id, values: ['Paris'] },
      ],
    },
    5,
    0,
  );
  fill.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Fill in the cities. ' },
        ...blanks.map((b) => ({ type: 'blank' as const, blankId: b.id })),
      ],
    },
  ];
  const gaps = Array.from({ length: 3 }, () => ({
    id: randomUUID(),
    points: 2,
    options: [choice('but'), choice('or')],
  }));
  const cloze = make(
    'CLOZE_CHOICE',
    { blanks: gaps },
    { answers: gaps.map((b) => ({ blankId: b.id, optionId: b.options[0]!.id })) },
    6,
    1,
  );
  cloze.prompt = [
    {
      id: randomUUID(),
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Choose the conjunctions. ' },
        ...gaps.map((b) => ({ type: 'blank' as const, blankId: b.id })),
      ],
    },
  ];
  const groups = [choice('Fruit'), choice('Vegetable')];
  const items = ['apple', 'banana', 'carrot', 'onion'].map((label) => ({
    ...choice(label),
    points: 1,
  }));
  const grouping = make(
    'GROUPING',
    { groups, items },
    {
      placements: items.map((item, i) => ({ itemId: item.id, groupId: groups[i < 2 ? 0 : 1]!.id })),
    },
    4,
    2,
  );
  const left = [choice('cat'), choice('dog')].map((item) => ({ ...item, points: 2 })),
    right = [choice('cat picture'), choice('dog picture'), choice('bird picture')];
  const matching = make(
    'MATCHING',
    { mode: 'ONE_TO_ONE', left, right },
    { pairs: left.map((item, i) => ({ leftId: item.id, rightId: right[i]!.id })) },
    4,
    3,
  );
  const cards = ['I', 'like', 'reading', '.'].map(choice);
  const ordering = make(
    'ORDERING',
    { items: cards, initialOrder: [] },
    { orders: [cards.map((item) => item.id)] },
    4,
    4,
  );
  const parent = make('COMPOSITE', { kind: 'READING' }, {}, 0, 5);
  const options = [choice('yes'), choice('no')];
  const single = make('SINGLE_CHOICE', { options }, { correctOptionId: options[0]!.id }, 6, 0);
  single.parentId = parent.id;
  const manual = make(
    'RESPONSE',
    {
      textEnabled: true,
      textRequired: true,
      minImages: 0,
      maxImages: 0,
      minAudios: 0,
      maxAudios: 0,
      rubric: [
        {
          id: randomUUID(),
          name: 'Meaning',
          description: 'Express the meaning accurately.',
          points: 4,
        },
      ],
    },
    { referenceText: 'Teacher-only example.' },
    4,
    1,
  );
  manual.parentId = parent.id;
  const answers: AnswerV2[] = [
    {
      questionId: fill.id,
      type: 'FILL_BLANK',
      payload: {
        blanks: blanks.map((b, i) => ({ blankId: b.id, text: i === 0 ? ' london ' : 'Paris' })),
      },
      evidenceAssetIds: [],
    },
    {
      questionId: cloze.id,
      type: 'CLOZE_CHOICE',
      payload: { blanks: gaps.map((b) => ({ blankId: b.id, optionId: b.options[0]!.id })) },
      evidenceAssetIds: [],
    },
    {
      questionId: grouping.id,
      type: 'GROUPING',
      payload: { placements: grouping.answerKey.placements },
      evidenceAssetIds: [],
    },
    {
      questionId: matching.id,
      type: 'MATCHING',
      payload: { pairs: matching.answerKey.pairs },
      evidenceAssetIds: [],
    },
    {
      questionId: ordering.id,
      type: 'ORDERING',
      payload: { orderedItemIds: ordering.answerKey.orders[0]!, confirmed: true },
      evidenceAssetIds: [],
    },
    {
      questionId: single.id,
      type: 'SINGLE_CHOICE',
      payload: { optionId: single.answerKey.correctOptionId! },
      evidenceAssetIds: [],
    },
    {
      questionId: manual.id,
      type: 'RESPONSE',
      payload: { text: 'My own explanation.', assetIds: [] },
      evidenceAssetIds: [],
    },
  ];
  return {
    questions: [fill, cloze, grouping, matching, ordering, parent, single, manual],
    answers,
    fill,
    cloze,
    grouping,
    matching,
    ordering,
    parent,
    single,
    manual,
  };
}
const payload = (questions: QuestionV2[]) => ({
  schemaVersion: 2,
  classId: ids.classroom,
  title: 'Mixed English assignment',
  description: '',
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  questions,
});
async function create(questions: QuestionV2[]) {
  return (
    await http
      .post('/api/assignments')
      .set('Authorization', auth())
      .send(payload(questions))
      .expect(201)
  ).body as { id: string; version: number; publishedVersion: number; questions: QuestionV2[] };
}
async function publish(draft: { id: string; version: number }) {
  return (
    await http
      .post(`/api/assignments/${draft.id}/publish`)
      .set('Authorization', auth())
      .send({ schemaVersion: 2, version: draft.version })
      .expect(201)
  ).body as { id: string; version: number; publishedVersion: number; questions: QuestionV2[] };
}
before(async () => {
  app = await createApp(true);
  db = app.get(Database);
  await migrate(db);
  await seed(db);
  http = supertest(app.getHttpServer());
  for (const role of ['teacher', 'other.teacher', 'student', 'other.student'])
    tokens[role] = (
      await http
        .post('/api/auth/login')
        .send({ email: `${role}@example.test`, password: process.env.DEMO_PASSWORD })
        .expect(201)
    ).body.token;
});
after(async () => {
  await app?.close();
});

test('validation checks the current unsaved snapshot without persisting or mixing in saved errors', async () => {
  const draft = await create([]);
  const q = fixture().single;
  q.parentId = null;
  q.position = 0;
  const check = await http
    .post(`/api/assignments/${draft.id}/validate`)
    .set('Authorization', auth())
    .send({ schemaVersion: 2, version: draft.version, questions: [q] })
    .expect(201);
  assert.equal(check.body.valid, true);
  const invalid = {
    ...q,
    config: {
      options: q.config.options.map((o, i) => (i === 1 ? { ...o, content: text('') } : o)),
    },
  };
  const failed = await http
    .post(`/api/assignments/${draft.id}/validate`)
    .set('Authorization', auth())
    .send({ schemaVersion: 2, version: draft.version, questions: [invalid] })
    .expect(201);
  assert.ok(
    failed.body.errors.some((p: { path: string }) => p.path === 'config.options.1.content'),
  );
  const saved = await http
    .get(`/api/assignments/${draft.id}?schemaVersion=2`)
    .set('Authorization', auth())
    .expect(200);
  assert.deepEqual(saved.body.questions, []);
  assert.equal(saved.body.version, draft.version);
  await http
    .post(`/api/assignments/${draft.id}/validate`)
    .set('Authorization', auth())
    .send({ schemaVersion: 2, version: draft.version + 1, questions: [q] })
    .expect(409);
  await http
    .post(`/api/assignments/${draft.id}/validate`)
    .set('Authorization', auth('other.teacher'))
    .send({ schemaVersion: 2, version: draft.version, questions: [q] })
    .expect(404);
  await http
    .post(`/api/assignments/${draft.id}/validate`)
    .set('Authorization', auth('student'))
    .send({ schemaVersion: 2, version: draft.version, questions: [q] })
    .expect(403);
});

test('v2 saves incomplete and empty drafts, but publication reports precise missing fields', async () => {
  const empty = await create([]);
  const check = await http
    .post(`/api/assignments/${empty.id}/validate`)
    .set('Authorization', auth())
    .send({ schemaVersion: 2, version: empty.version })
    .expect(201);
  assert.equal(check.body.valid, false);
  const failed = await http
    .post(`/api/assignments/${empty.id}/publish`)
    .set('Authorization', auth())
    .send({ schemaVersion: 2, version: empty.version })
    .expect(400);
  assert.equal(failed.body.code, 'PUBLICATION_INVALID');
  assert.ok(failed.body.errors.length);
  await http
    .get(`/api/assignments/${empty.id}?schemaVersion=2`)
    .set('Authorization', auth('student'))
    .expect(404);
  await http
    .post('/api/assignments')
    .set('Authorization', auth('student'))
    .send(payload([]))
    .expect(403);
  const invalid = fixture();
  invalid.single.parentId = randomUUID();
  await http
    .post('/api/assignments')
    .set('Authorization', auth())
    .send(payload(invalid.questions))
    .expect(400);
});
test('draft saves retain IDs, safely swap positions, preserve generated ordering and detect conflicts', async () => {
  const f = fixture(),
    draft = await create(f.questions);
  const ordering = draft.questions.find((q) => q.id === f.ordering.id)!;
  assert.ok(ordering.type === 'ORDERING' && ordering.config.initialOrder.length === 4);
  if (ordering.type !== 'ORDERING') throw new Error('Unexpected type.');
  assert.notDeepEqual(ordering.config.initialOrder, f.ordering.answerKey.orders[0]);
  const edited = draft.questions.map((q) => ({
    ...q,
    position:
      q.parentId === null && q.position === 0
        ? 1
        : q.parentId === null && q.position === 1
          ? 0
          : q.position,
  }));
  const saved = await http
    .patch(`/api/assignments/${draft.id}`)
    .set('Authorization', auth())
    .send({ ...payload(edited), version: draft.version })
    .expect(200);
  assert.deepEqual(
    new Set(saved.body.questions.map((q: QuestionV2) => q.id)),
    new Set(f.questions.map((q) => q.id)),
  );
  assert.deepEqual(
    saved.body.questions.find((q: QuestionV2) => q.id === ordering.id).config.initialOrder,
    ordering.config.initialOrder,
  );
  await http
    .patch(`/api/assignments/${draft.id}`)
    .set('Authorization', auth())
    .send({ ...payload(edited), version: draft.version })
    .expect(409);
  await http
    .post(`/api/assignments/${draft.id}/publish`)
    .set('Authorization', auth())
    .send({ schemaVersion: 2, version: draft.version })
    .expect(409);
  await publish(saved.body);
  await http
    .patch(`/api/assignments/${draft.id}`)
    .set('Authorization', auth())
    .send({ ...payload(edited), version: saved.body.version })
    .expect(409);
  await http.delete(`/api/assignments/${draft.id}`).set('Authorization', auth()).expect(409);
});
test('question ID collisions cannot overwrite another draft and create remains atomic', async () => {
  const f = fixture(),
    first = await create(f.questions);
  await http
    .post('/api/assignments')
    .set('Authorization', auth())
    .send(payload(f.questions))
    .expect(400);
  const [count] = await db.query('SELECT count(*) AS total FROM questions WHERE assignment_id=$1', [
    first.id,
  ]);
  assert.equal(Number(count!.total), 8);
  const read = await http
    .get(`/api/assignments/${first.id}?schemaVersion=2`)
    .set('Authorization', auth())
    .expect(200);
  assert.equal(read.body.questions.length, 8);
});
test('all objective types grade correctly, containers do not add points, and manual results remain pending', async () => {
  const f = fixture(),
    item = await publish(await create(f.questions));
  const student = await http
    .get(`/api/assignments/${item.id}?schemaVersion=2`)
    .set('Authorization', auth('student'))
    .expect(200);
  assert.equal(JSON.stringify(student.body).includes('answerKey'), false);
  assert.equal(JSON.stringify(student.body).includes('Teacher-only example'), false);
  assert.equal(JSON.stringify(student.body).includes('explanation'), false);
  await http.get(`/api/assignments/${item.id}`).set('Authorization', auth('student')).expect(409);
  const input = {
    schemaVersion: 2,
    publishedVersion: item.publishedVersion,
    requestId: randomUUID(),
    answers: f.answers,
  };
  const saved = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(input)
    .expect(201);
  assert.equal(saved.body.objectiveScore, 29);
  assert.equal(saved.body.objectiveMaxScore, 29);
  assert.equal(saved.body.maxScore, 33);
  assert.equal(saved.body.score, null);
  assert.equal(saved.body.gradingStatus, 'PENDING_REVIEW');
  const retry = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({ ...input, answers: [...f.answers].reverse() })
    .expect(201);
  assert.equal(retry.body.id, saved.body.id);
  const stats = await http
    .get(`/api/assignments/${item.id}/stats?schemaVersion=2`)
    .set('Authorization', auth())
    .expect(200);
  assert.equal(stats.body.submitted, 1);
  assert.equal(stats.body.pendingReviewCount, 1);
  assert.equal(stats.body.gradedCount, 0);
  assert.equal(stats.body.averagePercent, null);
  const own = await http
    .get(`/api/assignments/${item.id}/submissions/${saved.body.id}`)
    .set('Authorization', auth('student'))
    .expect(200);
  assert.equal(own.body.answers.length, 7);
  assert.equal(JSON.stringify(own.body.results).includes('correct'), false);
  assert.equal('gradingDraft' in own.body, false);
  await http
    .get(`/api/assignments/${item.id}/submissions/${saved.body.id}`)
    .set('Authorization', auth('other.student'))
    .expect(404);
});
test('final submissions reject missing, duplicate, foreign, container and manipulated answers', async () => {
  const f = fixture(),
    item = await publish(await create(f.questions));
  const base = {
    schemaVersion: 2,
    publishedVersion: item.publishedVersion,
    requestId: randomUUID(),
    answers: f.answers,
  };
  for (const answers of [
    f.answers.slice(1),
    [f.answers[0], ...f.answers],
    [...f.answers, { ...f.answers[0], questionId: f.parent.id }],
    f.answers.map((a, i) => (i === 0 ? { ...a, questionId: randomUUID() } : a)),
  ])
    await http
      .post(`/api/assignments/${item.id}/submissions`)
      .set('Authorization', auth('student'))
      .send({ ...base, answers })
      .expect(400);
  await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({ ...base, score: 33 })
    .expect(400);
  await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({ ...base, publishedVersion: 999 })
    .expect(409);
  const [count] = await db.query(
    'SELECT count(*) AS total FROM submissions WHERE assignment_id=$1',
    [item.id],
  );
  assert.equal(Number(count!.total), 0);
  const results = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(base)
    .expect(201);
  await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({ ...base, requestId: randomUUID() })
    .expect(409);
  const changed = f.answers.map((a) =>
    a.type === 'FILL_BLANK'
      ? { ...a, payload: { blanks: a.payload.blanks.map((b) => ({ ...b, text: b.text + ' ' })) } }
      : a,
  );
  await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({ ...base, answers: changed })
    .expect(409);
  await db.query(
    "UPDATE assignments SET due_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [item.id],
  );
  const replay = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(base)
    .expect(201);
  assert.equal(replay.body.id, results.body.id);
});
test('grading drafts are private, complete grading publishes atomically, and revisions preserve prior grades', async () => {
  const f = fixture(),
    item = await publish(await create(f.questions));
  const input = {
    schemaVersion: 2,
    publishedVersion: item.publishedVersion,
    requestId: randomUUID(),
    answers: f.answers,
  };
  const saved = (
    await http
      .post(`/api/assignments/${item.id}/submissions`)
      .set('Authorization', auth('student'))
      .send(input)
      .expect(201)
  ).body;
  const dimensionId = f.manual.config.rubric[0]!.id;
  const grade = {
    gradingVersion: 0,
    answers: [
      {
        questionId: f.manual.id,
        dimensions: [{ dimensionId, score: 3 }],
        feedback: 'Good explanation.',
      },
    ],
  };
  await http
    .patch(`/api/submissions/${saved.id}/grading`)
    .set('Authorization', auth('other.teacher'))
    .send(grade)
    .expect(404);
  await http
    .patch(`/api/submissions/${saved.id}/grading`)
    .set('Authorization', auth('student'))
    .send(grade)
    .expect(403);
  await http
    .patch(`/api/submissions/${saved.id}/grading`)
    .set('Authorization', auth())
    .send({ ...grade, answers: [{ ...grade.answers[0], dimensions: [{ dimensionId, score: 5 }] }] })
    .expect(400);
  const draft = (
    await http
      .patch(`/api/submissions/${saved.id}/grading`)
      .set('Authorization', auth())
      .send(grade)
      .expect(200)
  ).body;
  const studentDraft = await http
    .get(`/api/assignments/${item.id}/submissions/${saved.id}`)
    .set('Authorization', auth('student'))
    .expect(200);
  assert.equal(studentDraft.body.score, null);
  assert.equal(studentDraft.body.gradingVersion, 0);
  assert.equal(JSON.stringify(studentDraft.body).includes('Good explanation'), false);
  const publishInput = {
    gradingVersion: draft.gradingVersion,
    requestId: randomUUID(),
    reason: '',
  };
  const published = await http
    .post(`/api/submissions/${saved.id}/grading/publish`)
    .set('Authorization', auth())
    .send(publishInput)
    .expect(201);
  assert.equal(published.body.score, 32);
  const repeat = await http
    .post(`/api/submissions/${saved.id}/grading/publish`)
    .set('Authorization', auth())
    .send(publishInput)
    .expect(201);
  assert.equal(repeat.body.gradingVersion, published.body.gradingVersion);
  await http
    .post(`/api/submissions/${saved.id}/grading/publish`)
    .set('Authorization', auth())
    .send({ ...publishInput, reason: 'changed' })
    .expect(409);
  const changed = (
    await http
      .patch(`/api/submissions/${saved.id}/grading`)
      .set('Authorization', auth())
      .send({
        gradingVersion: published.body.gradingVersion,
        answers: [
          {
            questionId: f.manual.id,
            dimensions: [{ dimensionId, score: 4 }],
            feedback: 'Revised feedback.',
          },
        ],
      })
      .expect(200)
  ).body;
  const previous = await http
    .get(`/api/assignments/${item.id}/submissions/${saved.id}`)
    .set('Authorization', auth('student'))
    .expect(200);
  assert.equal(previous.body.score, 32);
  assert.equal(JSON.stringify(previous.body).includes('Revised feedback'), false);
  await http
    .post(`/api/submissions/${saved.id}/grading/publish`)
    .set('Authorization', auth())
    .send({ gradingVersion: changed.gradingVersion, requestId: randomUUID(), reason: '' })
    .expect(400);
  await http
    .post(`/api/submissions/${saved.id}/grading/publish`)
    .set('Authorization', auth())
    .send({
      gradingVersion: changed.gradingVersion,
      requestId: randomUUID(),
      reason: 'Rechecked the accuracy dimension.',
    })
    .expect(201);
  const final = await http
    .get(`/api/assignments/${item.id}/submissions/${saved.id}`)
    .set('Authorization', auth('student'))
    .expect(200);
  assert.equal(final.body.score, 33);
  assert.equal(final.body.gradingStatus, 'GRADED');
  assert.ok(JSON.stringify(final.body).includes('Revised feedback'));
  const [audit] = await db.query(
    'SELECT count(*) AS total FROM grading_revisions WHERE submission_id=$1',
    [saved.id],
  );
  assert.equal(Number(audit!.total), 2);
  const stats = await http
    .get(`/api/assignments/${item.id}/stats?schemaVersion=2`)
    .set('Authorization', auth())
    .expect(200);
  assert.equal(stats.body.averagePercent, 100);
  assert.equal(stats.body.gradedCount, 1);
  const replay = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(input)
    .expect(201);
  assert.equal(replay.body.id, saved.id);
  assert.equal(replay.body.score, 33);
});
test('attachment validation uses server ownership, question context, kind and readiness', async () => {
  const manual = make(
    'RESPONSE',
    {
      textEnabled: false,
      textRequired: false,
      minImages: 0,
      maxImages: 0,
      minAudios: 1,
      maxAudios: 1,
      rubric: [
        {
          id: randomUUID(),
          name: 'Reading',
          description: 'Read the paragraph accurately.',
          points: 4,
        },
      ],
    },
    { referenceText: '' },
    4,
    0,
  );
  const item = await publish(await create([manual]));
  // Fixtures test binding validation only. Actual upload/decoder tests are separate.
  async function asset(owner: string, questionId: string, kind: string, status: string) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO assets(id,owner_id,assignment_id,question_id,purpose,kind,status,upload_request_id,upload_hash,
      original_name,declared_mime,declared_bytes,actual_bytes,mime,storage_key,display_key,sha256)
      VALUES ($1::uuid,$2,$3,$4,'ANSWER',$5,$6,$7,'fixture','fixture','fixture',100,100,'fixture',($1::uuid)::text,($1::uuid)::text,'fixture')`,
      [id, owner, item.id, questionId, kind, status, randomUUID()],
    );
    return id;
  }
  const other = await asset(ids.outsider, manual.id, 'audio', 'READY');
  const wrongQuestion = await asset(ids.student, randomUUID(), 'audio', 'READY');
  const wrongKind = await asset(ids.student, manual.id, 'image', 'READY');
  const processing = await asset(ids.student, manual.id, 'audio', 'PROCESSING');
  const input = (id: string) => ({
    schemaVersion: 2,
    publishedVersion: item.publishedVersion,
    requestId: randomUUID(),
    answers: [
      {
        questionId: manual.id,
        type: 'RESPONSE',
        payload: { text: '', assetIds: [id] },
        evidenceAssetIds: [],
      },
    ],
  });
  for (const id of [other, wrongQuestion, wrongKind])
    await http
      .post(`/api/assignments/${item.id}/submissions`)
      .set('Authorization', auth('student'))
      .send(input(id))
      .expect(400);
  await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(input(processing))
    .expect(409);
  const oversized = await Promise.all(
    Array.from({ length: 3 }, () => asset(ids.student, manual.id, 'audio', 'READY')),
  );
  await db.query('UPDATE assets SET declared_bytes=$2,actual_bytes=$2 WHERE id=ANY($1::uuid[])', [
    oversized,
    50 * 1048576,
  ]);
  const excess = input(oversized[0]!);
  excess.answers[0]!.payload.assetIds = oversized;
  const rejected = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(excess)
    .expect(400);
  assert.match(rejected.body.message, /30 files or 100 MiB/);
  assert.equal(
    (await db.query('SELECT id FROM submissions WHERE assignment_id=$1', [item.id])).length,
    0,
  );
  assert.equal(
    (await db.query('SELECT 1 FROM asset_references WHERE asset_id=ANY($1::uuid[])', [oversized]))
      .length,
    0,
  );
  const ready = await asset(ids.student, manual.id, 'audio', 'READY');
  const saved = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(input(ready))
    .expect(201);
  assert.equal(saved.body.score, null);
  assert.equal(saved.body.objectiveMaxScore, 0);
  const [references] = await db.query(
    "SELECT count(*) AS total FROM asset_references WHERE reference_type='ANSWER' AND reference_id=$1",
    [saved.body.id],
  );
  assert.equal(Number(references!.total), 1);
});
test('optional handwritten evidence cannot replace an incorrect objective choice or trigger manual scoring', async () => {
  const options = ['Owl', 'Robin'].map((label) => ({
    id: randomUUID(),
    label,
    content: text(label),
  }));
  const q = make('SINGLE_CHOICE', { options }, { correctOptionId: options[0]!.id }, 6, 0);
  q.evidenceEnabled = true;
  const item = await publish(await create([q])),
    assetId = randomUUID();
  // Binding fixture only: real image decoding is independently covered in assets.test.ts.
  await db.query(
    `INSERT INTO assets(id,owner_id,assignment_id,question_id,purpose,kind,status,upload_request_id,upload_hash,
    original_name,declared_mime,declared_bytes,actual_bytes,mime,storage_key,display_key,sha256)
    VALUES ($1::uuid,$2,$3,$4,'ANSWER','image','READY',$5,'fixture','written-correct-answer.png','image/png',100,100,'image/png',($1::uuid)::text,($1::uuid)::text,'fixture')`,
    [assetId, ids.student, item.id, q.id, randomUUID()],
  );
  const saved = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({
      schemaVersion: 2,
      publishedVersion: item.publishedVersion,
      requestId: randomUUID(),
      answers: [
        {
          questionId: q.id,
          type: q.type,
          payload: { optionId: options[1]!.id },
          evidenceAssetIds: [assetId],
        },
      ],
    })
    .expect(201);
  assert.equal(saved.body.gradingStatus, 'GRADED');
  assert.equal(saved.body.score, 0);
  assert.equal(saved.body.maxScore, 6);
  const [reference] = await db.query(
    'SELECT reference_id FROM asset_references WHERE asset_id=$1',
    [assetId],
  );
  assert.equal(reference!.reference_id, saved.body.id);
});
test('new plain choices preserve actual option IDs when a legacy client submits indices', async () => {
  const options = [choice('First'), choice('Second')];
  const single = make('SINGLE_CHOICE', { options }, { correctOptionId: options[0]!.id }, 6, 0);
  const item = await publish(await create([single]));
  const input = { requestId: randomUUID(), answers: [{ questionId: single.id, selectedIndex: 0 }] };
  const saved = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(input)
    .expect(201);
  assert.equal(saved.body.score, 6);
  const detail = await http
    .get(`/api/assignments/${item.id}/submissions/${saved.body.id}`)
    .set('Authorization', auth('student'))
    .expect(200);
  assert.equal(detail.body.answers[0].payload.optionId, options[0]!.id);
  const retry = await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send(input)
    .expect(201);
  assert.equal(retry.body.id, saved.body.id);
  const [count] = await db.query(
    'SELECT count(*) AS total FROM answer_results WHERE submission_id=$1',
    [saved.body.id],
  );
  assert.equal(Number(count!.total), 1);
});
test('v2 concurrent submissions create one final attempt and empty analyses return null rates', async () => {
  const f = fixture(),
    item = await publish(await create(f.questions));
  const empty = await http
    .get(`/api/assignments/${item.id}/question-stats`)
    .set('Authorization', auth())
    .expect(200);
  assert.equal(
    empty.body.items.find((q: { questionId: string }) => q.questionId === f.fill.id).units[0]
      .correctPercent,
    null,
  );
  const base = { schemaVersion: 2, publishedVersion: item.publishedVersion, answers: f.answers };
  const results = await Promise.all([
    http
      .post(`/api/assignments/${item.id}/submissions`)
      .set('Authorization', auth('student'))
      .send({ ...base, requestId: randomUUID() }),
    http
      .post(`/api/assignments/${item.id}/submissions`)
      .set('Authorization', auth('student'))
      .send({ ...base, requestId: randomUUID() }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const [count] = await db.query(
    'SELECT count(*) AS total FROM submissions WHERE assignment_id=$1',
    [item.id],
  );
  assert.equal(Number(count!.total), 1);
  const roster = await http
    .get(`/api/assignments/${item.id}/submissions?schemaVersion=2&gradingStatus=PENDING_REVIEW`)
    .set('Authorization', auth())
    .expect(200);
  assert.equal(roster.body.total, 1);
  assert.equal(roster.body.items[0].submission.gradingStatus, 'PENDING_REVIEW');
});

test('statistics count one 9/10 final grade, one pending review and one unsubmitted student separately', async () => {
  const classroom = (
    await http
      .post('/api/classes')
      .set('Authorization', auth())
      .send({ name: `AC33 ${randomUUID()}` })
      .expect(201)
  ).body;
  const thirdId = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,role,password_hash) SELECT $1,$2,'Unsubmitted learner','STUDENT',password_hash FROM users WHERE id=$3",
    [thirdId, `${thirdId}@example.test`, ids.student],
  );
  for (const id of [ids.student, ids.outsider, thirdId])
    await db.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [
      classroom.id,
      id,
    ]);
  const options = ['Owl', 'Robin'].map((label) => ({
    id: randomUUID(),
    label,
    content: text(label),
  }));
  const choice = make('SINGLE_CHOICE', { options }, { correctOptionId: options[0]!.id }, 6, 0);
  const dimensionId = randomUUID();
  const manual = make(
    'RESPONSE',
    {
      textEnabled: true,
      textRequired: true,
      minImages: 0,
      maxImages: 0,
      minAudios: 0,
      maxAudios: 0,
      rubric: [
        {
          id: dimensionId,
          name: 'Clarity',
          description: 'Communicate the intended meaning.',
          points: 4,
        },
      ],
    },
    { referenceText: '' },
    4,
    1,
  );
  const draft = (
    await http
      .post('/api/assignments')
      .set('Authorization', auth())
      .send({ ...payload([choice, manual]), classId: classroom.id })
      .expect(201)
  ).body;
  const item = await publish(draft);
  const answers = [
    {
      questionId: choice.id,
      type: 'SINGLE_CHOICE',
      payload: { optionId: options[0]!.id },
      evidenceAssetIds: [],
    },
    {
      questionId: manual.id,
      type: 'RESPONSE',
      payload: { text: 'A robin sings.', assetIds: [] },
      evidenceAssetIds: [],
    },
  ];
  const submitted = [];
  for (const role of ['student', 'other.student'])
    submitted.push(
      (
        await http
          .post(`/api/assignments/${item.id}/submissions`)
          .set('Authorization', auth(role))
          .send({
            schemaVersion: 2,
            publishedVersion: item.publishedVersion,
            requestId: randomUUID(),
            answers,
          })
          .expect(201)
      ).body,
    );
  const grade = (
    await http
      .patch(`/api/submissions/${submitted[0].id}/grading`)
      .set('Authorization', auth())
      .send({
        gradingVersion: 0,
        answers: [
          {
            questionId: manual.id,
            dimensions: [{ dimensionId, score: 3 }],
            feedback: 'Clear meaning.',
          },
        ],
      })
      .expect(200)
  ).body;
  const final = (
    await http
      .post(`/api/submissions/${submitted[0].id}/grading/publish`)
      .set('Authorization', auth())
      .send({
        gradingVersion: grade.gradingVersion,
        requestId: randomUUID(),
        reason: '',
      })
      .expect(201)
  ).body;
  assert.equal(final.score, 9);
  assert.equal(final.maxScore, 10);
  const stats = (
    await http
      .get(`/api/assignments/${item.id}/stats?schemaVersion=2`)
      .set('Authorization', auth())
      .expect(200)
  ).body;
  assert.deepEqual(stats, {
    enrolled: 3,
    submitted: 2,
    gradedCount: 1,
    pendingReviewCount: 1,
    averagePercent: 90,
  });
  const report = (
    await http
      .get(`/api/assignments/${item.id}/submissions?schemaVersion=2`)
      .set('Authorization', auth())
      .expect(200)
  ).body;
  assert.equal(report.total, 3);
  assert.equal(
    report.items.find((row: { studentId: string }) => row.studentId === thirdId).submission,
    null,
  );
  const pending = report.items.find(
    (row: { studentId: string }) => row.studentId === ids.outsider,
  ).submission;
  assert.equal(pending.gradingStatus, 'PENDING_REVIEW');
  assert.equal(pending.score, null);
});
