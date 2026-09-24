import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/database/database.js';
import { migrate } from '../src/database/migrate.js';
import { ids, seed } from '../src/database/seed.js';
import { newToken, digest } from '../src/auth/session.js';
import { AssignmentsService } from '../src/assignments/assignments.service.js';
import type { Actor, AssignmentDetail } from '@amp/contracts';
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'TestPassword123!';
process.env.WEB_ORIGIN = 'http://localhost:5173';
process.env.DATABASE_DRIVER = process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'memory://';
let app: Awaited<ReturnType<typeof createApp>>;
let db: Database;
let http: ReturnType<typeof supertest>;
const tokens: Record<string, string> = {};
const bearer = (role = 'teacher') => `Bearer ${tokens[role]}`;
const input = (classId: string, title: string = randomUUID()) => ({
  classId,
  title,
  description: '',
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  questions: [{ prompt: 'Two plus two?', options: ['4', '5'], points: 10, correctIndex: 0 }],
});
const createClass = async () =>
  (
    await http
      .post('/api/classes')
      .set('Authorization', bearer())
      .send({ name: `Class ${randomUUID()}` })
      .expect(201)
  ).body.id as string;
const invite = async (classId: string, maxUses = 1) =>
  (
    await http
      .post(`/api/classes/${classId}/invitations`)
      .set('Authorization', bearer())
      .send({ maxUses, expiresInHours: 1 })
      .expect(201)
  ).body;
const join = (code: string, role = 'student') =>
  http.post('/api/classes/join').set('Authorization', bearer(role)).send({ invitation: code });
const create = async (classId = ids.classroom) =>
  (
    await http
      .post('/api/assignments')
      .set('Authorization', bearer())
      .send(input(classId))
      .expect(201)
  ).body as AssignmentDetail;
const publish = (id: string) =>
  http.post(`/api/assignments/${id}/publish`).set('Authorization', bearer()).expect(201);
const submitInput = (a: AssignmentDetail) => ({
  requestId: randomUUID(),
  answers: a.questions.map((q) => ({ questionId: q.id, selectedIndex: 0 })),
});
const submit = (a: AssignmentDetail, body = submitInput(a)) =>
  http
    .post(`/api/assignments/${a.id}/submissions`)
    .set('Authorization', bearer('student'))
    .send(body);
before(async () => {
  app = await createApp(true);
  db = app.get(Database);
  await migrate(db);
  await seed(db);
  http = supertest(app.getHttpServer());
  for (const role of ['teacher', 'other.teacher', 'student', 'other.student']) {
    tokens[role] = (
      await http
        .post('/api/auth/login')
        .send({ email: `${role}@example.test`, password: process.env.DEMO_PASSWORD })
        .expect(201)
    ).body.token;
  }
});
after(async () => {
  await app?.close();
});

test('migrations are repeatable and detect edited applied history', async () => {
  await migrate(db);
  const rows = await db.query('SELECT name,checksum FROM schema_migrations ORDER BY name');
  assert.equal(rows.length, 3);
  await db.query("UPDATE schema_migrations SET checksum='tampered' WHERE name='002_accounts'");
  try {
    await assert.rejects(migrate(db), /modified/);
  } finally {
    await db.query("UPDATE schema_migrations SET checksum=$1 WHERE name='002_accounts'", [
      rows[1]!.checksum,
    ]);
  }
  await migrate(db);
});
test('cookie sessions survive a reload, enforce origin, and logout revokes bearer and cookie', async () => {
  const login = await http
    .post('/api/auth/login')
    .set('Origin', process.env.WEB_ORIGIN!)
    .send({ email: 'student@example.test', password: process.env.DEMO_PASSWORD })
    .expect(201);
  const cookies = login.headers['set-cookie'] as unknown as string[];
  assert.ok(cookies?.[0]);
  const cookie = cookies[0].split(';')[0]!;
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /SameSite=Lax/);
  const [stored] = await db.query('SELECT token_hash FROM sessions WHERE token_hash=$1', [
    digest(login.body.token),
  ]);
  assert.ok(stored);
  assert.notEqual(stored.token_hash, login.body.token);
  await http.get('/api/auth/me').set('Cookie', cookie).expect(200);
  await http.post('/api/auth/logout').set('Cookie', cookie).expect(403);
  await http
    .post('/api/auth/logout')
    .set('Cookie', cookie)
    .set('Origin', 'https://attacker.invalid')
    .expect(403);
  await http.post('/api/auth/login').set('Origin', 'null').send({}).expect(403);
  await http
    .post('/api/auth/logout')
    .set('Cookie', cookie)
    .set('Origin', process.env.WEB_ORIGIN!)
    .expect(201);
  await http.get('/api/auth/me').set('Cookie', cookie).expect(401);
  await http.get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(401);
});
test('expired sessions cannot read or write', async () => {
  const token = newToken();
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,clock_timestamp()-interval '1 second')",
    [digest(token), ids.teacher],
  );
  await http.get('/api/assignments').set('Authorization', `Bearer ${token}`).expect(401);
  await http
    .post('/api/classes')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'No' })
    .expect(401);
});
test('only the owning teacher can manage members and invitations', async () => {
  const id = await createClass();
  const code = await invite(id);
  for (const path of [`/api/classes/${id}/members`, `/api/classes/${id}/invitations`]) {
    await http.get(path).set('Authorization', bearer('other.teacher')).expect(404);
    await http.get(path).set('Authorization', bearer('student')).expect(403);
  }
  await http
    .post('/api/classes')
    .set('Authorization', bearer('student'))
    .send({ name: 'Forbidden' })
    .expect(403);
  await http
    .post(`/api/classes/${id}/invitations`)
    .set('Authorization', bearer('other.teacher'))
    .send({})
    .expect(404);
  await http
    .delete(`/api/classes/${id}/members/${ids.student}`)
    .set('Authorization', bearer('other.teacher'))
    .expect(404);
  await http
    .delete(`/api/classes/${id}/invitations/${code.id}`)
    .set('Authorization', bearer('other.teacher'))
    .expect(404);
  await join(code.token, 'teacher').expect(403);
  const visible = await http
    .get(`/api/classes/${id}/invitations`)
    .set('Authorization', bearer())
    .expect(200);
  assert.ok(visible.body.every((x: object) => !('token_hash' in x) && !('token' in x)));
});
test('invitations require valid limits, expire and can be revoked', async () => {
  const id = await createClass();
  await http
    .post(`/api/classes/${id}/invitations`)
    .set('Authorization', bearer())
    .send({ maxUses: 0 })
    .expect(400);
  const expired = await invite(id);
  const revoked = await invite(id);
  await db.query(
    "UPDATE invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  await join(expired.token).expect(400);
  await http
    .delete(`/api/classes/${id}/invitations/${revoked.id}`)
    .set('Authorization', bearer())
    .expect(200);
  await join(revoked.token).expect(400);
});
test('concurrent joins cannot exceed an invitation usage limit', async () => {
  const id = await createClass();
  const code = await invite(id);
  const responses = await Promise.all([join(code.token), join(code.token, 'other.student')]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 400]);
  const [count] = await db.query('SELECT count(*) AS n FROM class_memberships WHERE class_id=$1', [
    id,
  ]);
  assert.equal(Number(count!.n), 1);
});
test('rejoining an existing membership does not consume another use', async () => {
  const id = await createClass();
  const code = await invite(id, 3);
  await join(code.token).expect(201);
  await join(code.token).expect(201);
  const [row] = await db.query('SELECT uses FROM invitations WHERE id=$1', [code.id]);
  assert.equal(row!.uses, 1);
});
test('invited registration is atomic and cannot choose a teacher role', async () => {
  const id = await createClass();
  const code = await invite(id, 2);
  const data = {
    email: `new-${randomUUID()}@example.test`,
    name: 'New Student',
    password: 'Registration123!',
    invitation: code.token,
  };
  await http
    .post('/api/auth/register')
    .send({ ...data, role: 'TEACHER' })
    .expect(400);
  const result = await http.post('/api/auth/register').send(data).expect(201);
  assert.equal(result.body.user.role, 'STUDENT');
  assert.equal(result.body.user.password_hash, undefined);
  await http.post('/api/auth/register').send(data).expect(409);
  const [row] = await db.query('SELECT uses FROM invitations WHERE id=$1', [code.id]);
  assert.equal(row!.uses, 1);
  const classes = await http
    .get('/api/classes')
    .set('Authorization', `Bearer ${result.body.token}`)
    .expect(200);
  assert.ok(classes.body.some((c: { id: string }) => c.id === id));
});
test('teacher invitations are email-bound and single-use', async () => {
  const token = newToken();
  const email = `teacher-${randomUUID()}@example.test`;
  await db.query(
    "INSERT INTO invitations(id,token_hash,kind,email,max_uses,expires_at) VALUES ($1,$2,'TEACHER',$3,1,clock_timestamp()+interval '1 hour')",
    [randomUUID(), digest(token), email],
  );
  const data = { email, name: 'New Teacher', password: 'Registration123!', invitation: token };
  await http
    .post('/api/auth/register')
    .send({ ...data, email: 'wrong@example.test' })
    .expect(403);
  const result = await http.post('/api/auth/register').send(data).expect(201);
  assert.equal(result.body.user.role, 'TEACHER');
  await http.post('/api/auth/register').send(data).expect(400);
});
test('published audience is fixed; removal revokes access without erasing grades, even after rejoining', async () => {
  const id = await createClass();
  const code = await invite(id, 5);
  await join(code.token).expect(201);
  const a = await create(id);
  const b = await create(id);
  await publish(a.id);
  await publish(b.id);
  const accepted = submitInput(a);
  await submit(a, accepted).expect(201);
  await join(code.token, 'other.student').expect(201);
  await http
    .get(`/api/assignments/${a.id}`)
    .set('Authorization', bearer('other.student'))
    .expect(404);
  await http
    .delete(`/api/classes/${id}/members/${ids.student}`)
    .set('Authorization', bearer())
    .expect(200);
  await http.get(`/api/assignments/${a.id}`).set('Authorization', bearer('student')).expect(404);
  await submit(a, accepted).expect(404);
  await submit(b).expect(404);
  await join(code.token).expect(201);
  await submit(b).expect(404);
  const listed = await http
    .get(`/api/assignments?classId=${id}`)
    .set('Authorization', bearer('student'))
    .expect(200);
  assert.equal(listed.body.total, 0);
  const stats = await http
    .get(`/api/assignments/${a.id}/stats`)
    .set('Authorization', bearer())
    .expect(200);
  assert.deepEqual(stats.body, { enrolled: 1, submitted: 1, averagePercent: 100 });
  const report = await http
    .get(`/api/assignments/${a.id}/submissions`)
    .set('Authorization', bearer())
    .expect(200);
  assert.equal(report.body.items[0].removed, true);
  assert.equal(report.body.items[0].submission.score, 10);
  const future = await create(id);
  await publish(future.id);
  await http
    .get(`/api/assignments/${future.id}`)
    .set('Authorization', bearer('student'))
    .expect(200);
});
test('empty reports distinguish no submissions from a zero score', async () => {
  const a = await create();
  await publish(a.id);
  const report = await http
    .get(`/api/assignments/${a.id}/submissions`)
    .set('Authorization', bearer())
    .expect(200);
  assert.equal(report.body.items[0].submission, null);
  const stats = await http
    .get(`/api/assignments/${a.id}/stats`)
    .set('Authorization', bearer())
    .expect(200);
  assert.equal(stats.body.averagePercent, null);
  await http
    .get(`/api/assignments/${a.id}/submissions`)
    .set('Authorization', bearer('other.teacher'))
    .expect(404);
  await http
    .get(`/api/assignments/${a.id}/submissions`)
    .set('Authorization', bearer('student'))
    .expect(403);
});
test('draft edits use a version and published content cannot be edited or deleted', async () => {
  const a = await create();
  const next = { ...input(a.classId, 'Updated draft'), version: a.version };
  await http
    .patch(`/api/assignments/${a.id}`)
    .set('Authorization', bearer('other.teacher'))
    .send(next)
    .expect(404);
  await http
    .patch(`/api/assignments/${a.id}`)
    .set('Authorization', bearer('student'))
    .send(next)
    .expect(403);
  const updated = await http
    .patch(`/api/assignments/${a.id}`)
    .set('Authorization', bearer())
    .send(next)
    .expect(200);
  assert.equal(updated.body.version, a.version + 1);
  assert.notEqual(updated.body.questions[0].id, a.questions[0]!.id);
  await http
    .patch(`/api/assignments/${a.id}`)
    .set('Authorization', bearer())
    .send(next)
    .expect(409);
  await publish(a.id);
  await http
    .patch(`/api/assignments/${a.id}`)
    .set('Authorization', bearer())
    .send({ ...next, version: updated.body.version })
    .expect(409);
  await http.delete(`/api/assignments/${a.id}`).set('Authorization', bearer()).expect(409);
  const draft = await create();
  await http
    .delete(`/api/assignments/${draft.id}`)
    .set('Authorization', bearer('other.teacher'))
    .expect(404);
  await http.delete(`/api/assignments/${draft.id}`).set('Authorization', bearer()).expect(200);
  assert.equal(
    (await db.query('SELECT id FROM questions WHERE assignment_id=$1', [draft.id])).length,
    0,
  );
});
test('simultaneous draft editors cannot silently overwrite each other', async () => {
  const a = await create();
  const result = await Promise.all(
    ['First edit', 'Second edit'].map((title) =>
      http
        .patch(`/api/assignments/${a.id}`)
        .set('Authorization', bearer())
        .send({ ...input(a.classId, title), version: a.version }),
    ),
  );
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
});
test('simultaneous publications create exactly one recipient snapshot', async () => {
  const a = await create();
  await Promise.all([publish(a.id), publish(a.id)]);
  const [row] = await db.query(
    'SELECT count(*) AS n FROM assignment_recipients WHERE assignment_id=$1',
    [a.id],
  );
  assert.equal(Number(row!.n), 1);
});
test('failed draft replacement restores the original questions, title and version', async () => {
  const a = await create();
  const actor = {
    id: ids.teacher,
    name: 'Teacher',
    email: 'teacher@example.test',
    role: 'TEACHER',
  } as Actor;
  await assert.rejects(
    app.get(AssignmentsService).update(actor, a.id, {
      ...input(a.classId, 'Must roll back'),
      version: a.version,
      questions: [{ prompt: 'Invalid', options: ['A', 'B'], correctIndex: 9, points: 10 }],
    }),
  );
  const saved = await http
    .get(`/api/assignments/${a.id}`)
    .set('Authorization', bearer())
    .expect(200);
  assert.equal(saved.body.title, a.title);
  assert.equal(saved.body.version, a.version);
  assert.deepEqual(saved.body.questions, a.questions);
});
test('filters are scoped, literal, stably ordered and paginate without overlap', async () => {
  const classId = await createClass();
  const marker = `Filter %_ ${randomUUID()}`;
  const created: string[] = [];
  for (let i = 0; i < 5; i++)
    created.push(
      (
        await http
          .post('/api/assignments')
          .set('Authorization', bearer())
          .send(input(classId, `${marker} ${i}`))
          .expect(201)
      ).body.id,
    );
  const query = `/api/assignments?classId=${classId}&search=${encodeURIComponent(marker)}&pageSize=2`;
  const pages = await Promise.all(
    [1, 2, 3].map((page) =>
      http.get(`${query}&page=${page}`).set('Authorization', bearer()).expect(200),
    ),
  );
  const found = pages.flatMap((p) => p.body.items.map((x: { id: string }) => x.id));
  assert.equal(new Set(found).size, 5);
  assert.deepEqual(new Set(found), new Set(created));
  assert.ok(pages.every((p) => p.body.total === 5));
  await publish(created[0]!);
  await db.query(
    "UPDATE assignments SET due_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [created[0]],
  );
  const closed = await http
    .get(`${query}&status=CLOSED`)
    .set('Authorization', bearer())
    .expect(200);
  assert.equal(closed.body.total, 1);
  const other = await http.get(query).set('Authorization', bearer('other.teacher')).expect(200);
  assert.equal(other.body.total, 0);
  await http.get('/api/assignments?status=INVALID').set('Authorization', bearer()).expect(400);
});
test('different concurrent request IDs cannot create two final submissions', async () => {
  const a = await create();
  await publish(a.id);
  const results = await Promise.all([submit(a), submit(a)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const [row] = await db.query('SELECT count(*) AS n FROM submissions WHERE assignment_id=$1', [
    a.id,
  ]);
  assert.equal(Number(row!.n), 1);
});
test('a lost response can be retried; a reused request ID with another assignment conflicts', async () => {
  const a = await create();
  const b = await create();
  await publish(a.id);
  await publish(b.id);
  const request = submitInput(a);
  await submit(a, request).expect(201);
  const replay = await submit(a, request).expect(201);
  assert.equal(replay.body.score, 10);
  await submit(b, { ...submitInput(b), requestId: request.requestId }).expect(409);
});
test('an insert failure rolls back grading and the same request can be retried', async () => {
  const a = await create();
  await publish(a.id);
  const request = submitInput(a);
  await db.exec(`CREATE FUNCTION reject_test_submission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.assignment_id='${a.id}'::uuid THEN RAISE EXCEPTION 'synthetic grading write failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_submission AFTER INSERT ON submissions FOR EACH ROW EXECUTE FUNCTION reject_test_submission();`);
  try {
    const failure = await submit(a, request).expect(500);
    assert.ok(failure.body.requestId);
    assert.equal(failure.body.message, 'An unexpected error occurred.');
    assert.equal(
      (await db.query('SELECT id FROM submissions WHERE assignment_id=$1', [a.id])).length,
      0,
    );
  } finally {
    await db.exec(
      'DROP TRIGGER reject_test_submission ON submissions; DROP FUNCTION reject_test_submission();',
    );
  }
  await submit(a, request).expect(201);
});
test(
  'PostgreSQL tests actually use multiple independent database connections',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const pids = await Promise.all(
      [0, 1].map(() =>
        db.transaction(async (tx) => {
          const [row] = await tx.query('SELECT pg_backend_pid() AS pid,pg_sleep(0.05)');
          return row!.pid;
        }),
      ),
    );
    assert.notEqual(pids[0], pids[1]);
  },
);
test('changing a password revokes all sessions and requires the current password', async () => {
  const id = await createClass();
  const code = await invite(id);
  const email = `password-${randomUUID()}@example.test`;
  const account = await http
    .post('/api/auth/register')
    .send({
      email,
      name: 'Password Test',
      password: 'OriginalPassword123!',
      invitation: code.token,
    })
    .expect(201);
  const second = await http
    .post('/api/auth/login')
    .send({ email, password: 'OriginalPassword123!' })
    .expect(201);
  const token = `Bearer ${account.body.token}`;
  await http
    .post('/api/auth/password')
    .set('Authorization', token)
    .send({ currentPassword: 'wrong', newPassword: 'ReplacementPassword123!' })
    .expect(401);
  await http
    .post('/api/auth/password')
    .set('Authorization', token)
    .send({ currentPassword: 'OriginalPassword123!', newPassword: 'ReplacementPassword123!' })
    .expect(201);
  await http.get('/api/auth/me').set('Authorization', token).expect(401);
  await http.get('/api/auth/me').set('Authorization', `Bearer ${second.body.token}`).expect(401);
  await http.post('/api/auth/login').send({ email, password: 'OriginalPassword123!' }).expect(401);
  await http
    .post('/api/auth/login')
    .send({ email, password: 'ReplacementPassword123!' })
    .expect(201);
});

test('a database outage returns a traceable error and recovers without restarting', async () => {
  const original = db.query;
  db.query = async () => {
    throw new Error('synthetic database outage');
  };
  try {
    const response = await http.get('/api/health').expect(500);
    assert.equal(response.body.message, 'An unexpected error occurred.');
    assert.equal(response.body.requestId, response.headers['x-request-id']);
  } finally {
    db.query = original;
  }
  await http.get('/api/health').expect(200);
});

test(
  'deadline uses the database clock at acceptance, including a request delayed on a recipient lock',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const a = await create();
    await publish(a.id);
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const unblock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await tx.query('SELECT 1 FROM assignment_recipients WHERE assignment_id=$1 FOR UPDATE', [
        a.id,
      ]);
      ready();
      await unblock;
      await tx.query('UPDATE assignments SET due_at=clock_timestamp() WHERE id=$1', [a.id]);
    });
    await locked;
    const pending = submit(a).then((response) => response);
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await db.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM assignment_recipients%' AND pid<>pg_backend_pid()",
        );
        if (rows.length) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(
        waiting,
        'The HTTP submission must be waiting on the locked recipient before the deadline changes.',
      );
    } finally {
      release();
      await blocker;
    }
    assert.equal((await pending).status, 409);
    assert.equal(
      (await db.query('SELECT id FROM submissions WHERE assignment_id=$1', [a.id])).length,
      0,
    );
  },
);

test('UUID spelling does not change question identity or exact retry semantics', async () => {
  const classId = await createClass();
  await db.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [
    classId,
    ids.student,
  ]);
  const a = await create(classId);
  const edited = await http
    .patch(`/api/assignments/${a.id.toUpperCase()}`)
    .set('Authorization', bearer())
    .send({ ...input(classId.toUpperCase()), version: a.version })
    .expect(200);
  await publish(a.id.toUpperCase());
  const request = submitInput(edited.body);
  const first = await http
    .post(`/api/assignments/${a.id.toUpperCase()}/submissions`)
    .set('Authorization', bearer('student'))
    .send({
      requestId: request.requestId.toUpperCase(),
      answers: request.answers.map((answer) => ({
        ...answer,
        questionId: answer.questionId.toUpperCase(),
      })),
    })
    .expect(201);
  const replay = await submit(edited.body, request).expect(201);
  assert.equal(first.body.id, replay.body.id);
  await submit(edited.body, {
    ...request,
    answers: [
      request.answers[0]!,
      { ...request.answers[0]!, questionId: request.answers[0]!.questionId.toUpperCase() },
    ],
  }).expect(400);
});

// Pause after metadata is read, commit a concurrent writer through another connection,
// then let the original request finish. Instrument both pool reads and transaction reads
// so this proves the interleaving before and after the implementation changes.
async function interleaveAfterMetadata(
  id: string,
  change: () => Promise<void>,
  read: () => Promise<unknown>,
) {
  const originalQuery = db.query.bind(db);
  const originalTransaction = db.transaction.bind(db);
  let interleaved = false;
  const wrap = (
    connection: import('../src/database/database.js').Connection,
  ): import('../src/database/database.js').Connection => ({
    exec: (sql) => connection.exec(sql),
    query: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const rows = await connection.query<T>(sql, params);
      if (!interleaved && sql.includes('c.teacher_id AS "teacherId"') && params[0] === id) {
        interleaved = true;
        await change();
      }
      return rows;
    },
  });
  db.query = wrap({ query: originalQuery, exec: (sql) => db.exec(sql) }).query;
  db.transaction = (work) => originalTransaction((tx) => work(wrap(tx)));
  try {
    await read();
    assert.ok(interleaved, 'A separate write must commit while the reader is open.');
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
}

test(
  'a draft preview never combines metadata and questions from different versions',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const a = await create();
    await interleaveAfterMetadata(
      a.id,
      async () => {
        await db.transaction(async (tx) => {
          await tx.query(
            "UPDATE assignments SET title='New revision',version=version+1 WHERE id=$1",
            [a.id],
          );
          await tx.query(
            "UPDATE questions SET prompt='New revision question' WHERE assignment_id=$1",
            [a.id],
          );
        });
      },
      async () => {
        const result = await http
          .get(`/api/assignments/${a.id}`)
          .set('Authorization', bearer())
          .expect(200);
        assert.equal(result.body.title, a.title);
        assert.equal(result.body.version, a.version);
        assert.deepEqual(result.body.questions, a.questions);
      },
    );
    const fresh = await http
      .get(`/api/assignments/${a.id}`)
      .set('Authorization', bearer())
      .expect(200);
    assert.equal(fresh.body.title, 'New revision');
    assert.equal(fresh.body.questions[0].prompt, 'New revision question');
  },
);

for (const resource of ['stats', 'submissions']) {
  test(
    `${resource} keeps its audience consistent during publication and enrollment`,
    { skip: !process.env.TEST_DATABASE_URL },
    async () => {
      const classId = await createClass();
      await db.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [
        classId,
        ids.student,
      ]);
      const a = await create(classId);
      await interleaveAfterMetadata(
        a.id,
        async () => {
          await db.transaction(async (tx) => {
            await tx.query(
              "UPDATE assignments SET status='PUBLISHED',published_at=clock_timestamp() WHERE id=$1",
              [a.id],
            );
            await tx.query(
              'INSERT INTO assignment_recipients(assignment_id,student_id) VALUES ($1,$2)',
              [a.id, ids.student],
            );
            await tx.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [
              classId,
              ids.outsider,
            ]);
          });
        },
        async () => {
          const result = await http
            .get(`/api/assignments/${a.id}/${resource}`)
            .set('Authorization', bearer())
            .expect(200);
          assert.equal(resource === 'stats' ? result.body.enrolled : result.body.total, 1);
        },
      );
    },
  );
}
