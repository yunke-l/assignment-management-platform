import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import supertest from 'supertest';
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
  const before = await snapshot(db);
  await app.close();
  app = undefined;
  const backupStarted = performance.now();
  await cp(source, backup, { recursive: true, errorOnExist: true, force: false });
  const backupMs = performance.now() - backupStarted;
  const restoreStarted = performance.now();
  await cp(backup, restored, { recursive: true, errorOnExist: true, force: false });
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
    assertions: [
      'All ten table counts and SHA-256 logical data digests match',
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
