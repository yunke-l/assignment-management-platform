import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/database/database.js';
import { migrate } from '../src/database/migrate.js';
import { ids, seed } from '../src/database/seed.js';
import { digest } from '../src/auth/session.js';
import type { AssignmentDetail } from '@amp/contracts';

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'TestPassword123!';
// CI sets TEST_DATABASE_URL to a fresh PostgreSQL service. Local tests default to embedded PostgreSQL.
process.env.DATABASE_DRIVER = process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'memory://';

let app: Awaited<ReturnType<typeof createApp>>;
let db: Database;
let http: ReturnType<typeof supertest>;
const tokens: Record<string, string> = {};
let assignment: AssignmentDetail;
const payload = () => ({
  classId: ids.classroom,
  title: `Reading check ${randomUUID().slice(0, 6)}`,
  description: 'A short check.',
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  questions: [
    { prompt: 'Which word is a noun?', options: ['Book', 'Quickly'], correctIndex: 0, points: 10 },
    { prompt: 'Choose the verb.', options: ['Blue', 'Run'], correctIndex: 1, points: 20 },
  ],
});
const auth = (role = 'teacher') => `Bearer ${tokens[role]}`;
const create = async () => {
  const res = await http
    .post('/api/assignments')
    .set('Authorization', auth())
    .send(payload())
    .expect(201);
  return res.body as AssignmentDetail;
};
const publish = async (id: string) => {
  const detail = await http.get(`/api/assignments/${id}`).set('Authorization', auth()).expect(200);
  return http
    .post(`/api/assignments/${id}/publish`)
    .set('Authorization', auth())
    .send({ version: detail.body.version })
    .expect(201);
};
const answersFor = (item: AssignmentDetail) =>
  item.questions.map((q) => ({ questionId: q.id, selectedIndex: 0 }));

before(async () => {
  app = await createApp(true);
  db = app.get(Database);
  await migrate(db);
  await migrate(db);
  await seed(db);
  http = supertest(app.getHttpServer());
  for (const role of ['teacher', 'other.teacher', 'student', 'other.student']) {
    const res = await http
      .post('/api/auth/login')
      .send({ email: `${role}@example.test`, password: process.env.DEMO_PASSWORD })
      .expect(201);
    tokens[role] = res.body.token;
    assert.equal(res.body.user.password_hash, undefined);
  }
});
after(async () => {
  await app?.close();
});

test('health checks the database; protected routes require a verified token', async () => {
  await http.get('/api/health').expect(200);
  await http.get('/api/assignments').expect(401);
  await http.get('/api/assignments').set('Authorization', 'Bearer forged-token').expect(401);
});
test('validates payloads, roles, resource ownership and deadlines on the server', async () => {
  await http
    .post('/api/assignments')
    .set('Authorization', auth('student'))
    .send(payload())
    .expect(403);
  await http
    .post('/api/assignments')
    .set('Authorization', auth())
    .send({ ...payload(), classId: ids.otherClassroom })
    .expect(404);
  await http
    .post('/api/assignments')
    .set('Authorization', auth())
    .send({ ...payload(), dueAt: new Date(0).toISOString() })
    .expect(400);
  await http
    .post('/api/assignments')
    .set('Authorization', auth())
    .send({ ...payload(), questions: [] })
    .expect(400);
  await http.get('/api/assignments/not-a-uuid').set('Authorization', auth()).expect(400);
  await http.get('/api/assignments?pageSize=10000').set('Authorization', auth()).expect(400);
});
test('creates a complete draft and only exposes it to its teacher', async () => {
  assignment = await create();
  assert.equal(assignment.status, 'DRAFT');
  assert.equal(assignment.questions.length, 2);
  await http
    .get(`/api/assignments/${assignment.id}`)
    .set('Authorization', auth('student'))
    .expect(404);
  const res = await http.get('/api/assignments').set('Authorization', auth('student')).expect(200);
  assert.ok(!res.body.items.some((item: { id: string }) => item.id === assignment.id));
});
test('enforces teacher ownership for publishing and reporting', async () => {
  await http
    .post(`/api/assignments/${assignment.id}/publish`)
    .set('Authorization', auth('other.teacher'))
    .expect(404);
  await http
    .get(`/api/assignments/${assignment.id}/stats`)
    .set('Authorization', auth('other.teacher'))
    .expect(404);
  await publish(assignment.id);
  await publish(assignment.id);
});
test('enforces enrollment and strips answer keys from student responses', async () => {
  await http
    .get(`/api/assignments/${assignment.id}`)
    .set('Authorization', auth('other.student'))
    .expect(404);
  const res = await http
    .get(`/api/assignments/${assignment.id}`)
    .set('Authorization', auth('student'))
    .expect(200);
  assert.ok(
    res.body.questions.every(
      (q: Record<string, unknown>) => !('correctIndex' in q) && !('correct_index' in q),
    ),
  );
  assert.equal(res.body.teacherId, undefined);
});
test('rejects incomplete, duplicate, foreign and manipulated answer payloads', async () => {
  const path = `/api/assignments/${assignment.id}/submissions`;
  const answers = answersFor(assignment);
  await http
    .post(path)
    .set('Authorization', auth('student'))
    .send({ requestId: randomUUID(), answers: answers.slice(0, 1) })
    .expect(400);
  await http
    .post(path)
    .set('Authorization', auth('student'))
    .send({ requestId: randomUUID(), answers: [answers[0], answers[0]] })
    .expect(400);
  await http
    .post(path)
    .set('Authorization', auth('student'))
    .send({
      requestId: randomUUID(),
      answers: [{ questionId: randomUUID(), selectedIndex: 0 }, answers[1]],
    })
    .expect(400);
  await http
    .post(path)
    .set('Authorization', auth('student'))
    .send({ requestId: randomUUID(), answers, score: 100 })
    .expect(400);
  await http
    .post(path)
    .set('Authorization', auth('other.student'))
    .send({ requestId: randomUUID(), answers })
    .expect(404);
  const [row] = await db.query('SELECT count(*) AS count FROM submissions WHERE assignment_id=$1', [
    assignment.id,
  ]);
  assert.equal(Number(row?.count), 0);
});
test('grades on the server and makes exact retries idempotent', async () => {
  const path = `/api/assignments/${assignment.id}/submissions`;
  const input = { requestId: randomUUID(), answers: answersFor(assignment) };
  const first = await http.post(path).set('Authorization', auth('student')).send(input).expect(201);
  assert.equal(first.body.score, 10);
  assert.equal(first.body.maxScore, 30);
  const repeat = await http
    .post(path)
    .set('Authorization', auth('student'))
    .send({ ...input, answers: [...input.answers].reverse() })
    .expect(201);
  assert.equal(first.body.id, repeat.body.id);
  await http
    .post(path)
    .set('Authorization', auth('student'))
    .send({ ...input, answers: input.answers.map((a) => ({ ...a, selectedIndex: 1 })) })
    .expect(409);
  await http
    .post(path)
    .set('Authorization', auth('student'))
    .send({ ...input, requestId: randomUUID() })
    .expect(409);
  await db.query(
    "UPDATE assignments SET due_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [assignment.id],
  );
  const [session] = await db.query(
    'SELECT revoked_at IS NULL AS active,expires_at>clock_timestamp() AS valid FROM sessions WHERE token_hash=$1',
    [digest(tokens.student!)],
  );
  assert.deepEqual(session, { active: true, valid: true });
  const afterDeadline = await Promise.all(
    Array.from({ length: 12 }, () =>
      http.post(path).set('Authorization', auth('student')).send(input),
    ),
  );
  for (const replay of afterDeadline) {
    assert.equal(replay.status, 201, JSON.stringify(replay.body));
    assert.equal(replay.body.id, first.body.id);
    assert.equal(replay.body.score, first.body.score);
  }
});
test('computes teacher-only aggregate results', async () => {
  const path = `/api/assignments/${assignment.id}/stats`;
  const res = await http.get(path).set('Authorization', auth()).expect(200);
  assert.equal(res.body.submitted, 1);
  assert.equal(res.body.enrolled, 1);
  assert.equal(res.body.averagePercent, 33.3);
  await http.get(path).set('Authorization', auth('student')).expect(403);
});
test('rejects new submissions after the database deadline', async () => {
  const item = await create();
  await publish(item.id);
  await db.query(
    "UPDATE assignments SET due_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [item.id],
  );
  await http
    .post(`/api/assignments/${item.id}/submissions`)
    .set('Authorization', auth('student'))
    .send({ requestId: randomUUID(), answers: answersFor(item) })
    .expect(409);
});
test('concurrent identical requests create only one submission', async () => {
  const item = await create();
  await publish(item.id);
  const input = { requestId: randomUUID(), answers: answersFor(item) };
  const [first, second] = await Promise.all(
    [0, 1].map(() =>
      http
        .post(`/api/assignments/${item.id}/submissions`)
        .set('Authorization', auth('student'))
        .send(input)
        .expect(201),
    ),
  );
  assert.ok(first && second);
  assert.equal(first.body.id, second.body.id);
  const [row] = await db.query('SELECT count(*) AS count FROM submissions WHERE assignment_id=$1', [
    item.id,
  ]);
  assert.equal(Number(row?.count), 1);
});
test('rolls back the assignment when a question insert violates a constraint', async () => {
  const id = randomUUID();
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query('INSERT INTO assignments(id,class_id,title,due_at) VALUES ($1,$2,$3,$4)', [
        id,
        ids.classroom,
        'Must roll back',
        new Date(Date.now() + 60000),
      ]);
      await tx.query(
        'INSERT INTO questions(id,assignment_id,position,prompt,options,correct_index,points) VALUES ($1,$2,0,$3,$4::jsonb,99,10)',
        [randomUUID(), id, 'Invalid question', '["A","B"]'],
      );
    }),
  );
  assert.equal((await db.query('SELECT id FROM assignments WHERE id=$1', [id])).length, 0);
});
test('login attempts are rate-limited', async () => {
  let limited = false;
  for (let i = 0; i < 11; i++) {
    const res = await http
      .post('/api/auth/login')
      .send({ email: 'nobody@example.test', password: 'wrong' });
    if (res.status === 429) limited = true;
  }
  assert.equal(limited, true);
});
