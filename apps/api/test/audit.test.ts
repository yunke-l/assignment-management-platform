import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/database/database.js';
import { migrate } from '../src/database/migrate.js';
import { ids, seed } from '../src/database/seed.js';
import { settings } from '../src/config.js';
import { mediaLimits } from '@amp/contracts';

process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'TestPassword123!';
process.env.DATABASE_DRIVER = process.env.TEST_DATABASE_URL ? 'postgres' : 'pglite';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'memory://';
let app: Awaited<ReturnType<typeof createApp>>;
let http: ReturnType<typeof supertest>;
let auth: string;
before(async () => {
  app = await createApp(true);
  const db = app.get(Database);
  await migrate(db);
  await seed(db);
  // Existing fixtures from another test file deliberately keep their own passwords.
  const token = randomUUID().replaceAll('-', '') + 'audit-token';
  const { digest } = await import('../src/auth/session.js');
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [digest(token), ids.teacher],
  );
  auth = `Bearer ${token}`;
  http = supertest(app.getHttpServer());
});
after(async () => {
  await app?.close();
});

const assignment = (large = false) => ({
  classId: ids.classroom,
  title: 'Audit assignment',
  description: '',
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  questions: Array.from({ length: large ? 20 : 1 }, () => ({
    prompt: large ? '漢'.repeat(1000) : 'Select one.',
    options: large ? Array.from({ length: 6 }, () => '漢'.repeat(500)) : ['A', 'B'],
    correctIndex: 0,
    points: 10,
  })),
});
test('malformed JSON is a traceable client error', async () => {
  const response = await http.post('/api/auth/login').type('json').send('{"invalid":').expect(400);
  assert.equal(response.body.requestId, response.headers['x-request-id']);
});
test('oversized JSON returns 413 rather than an internal-server error', async () => {
  const response = await http
    .post('/api/auth/login')
    .type('json')
    .send(JSON.stringify({ value: 'x'.repeat(mediaLimits.jsonBytes + 1) }))
    .expect(413);
  assert.equal(response.body.requestId, response.headers['x-request-id']);
});
test('the body limit accepts the largest Unicode assignment allowed by the contract', async () => {
  const response = await http
    .post('/api/assignments')
    .set('Authorization', auth)
    .send(assignment(true))
    .expect(201);
  assert.equal(response.body.questions.length, 20);
  assert.equal(response.body.questions[19].options[5], '漢'.repeat(500));
});
test('assignment and invitation timestamps are portable ISO timestamps', async () => {
  const response = await http
    .post('/api/assignments')
    .set('Authorization', auth)
    .send(assignment())
    .expect(201);
  for (const field of ['dueAt', 'createdAt']) {
    assert.match(response.body[field], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  }
  const invitation = await http
    .post(`/api/classes/${ids.classroom}/invitations`)
    .set('Authorization', auth)
    .send({})
    .expect(201);
  assert.match(invitation.body.expiresAt, /^\d{4}-\d\d-\d\dT.*Z$/);
});
test('production rejects credentials, queries and fragments in WEB_ORIGIN', () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      ALLOW_DEMO_SEED: 'false',
      DATABASE_DRIVER: 'postgres',
    });
    for (const value of [
      'https://user:secret@example.com',
      'https://example.com?query',
      'https://example.com#fragment',
    ]) {
      process.env.WEB_ORIGIN = value;
      assert.throws(settings, /exact HTTPS WEB_ORIGIN/);
    }
    process.env.WEB_ORIGIN = 'https://example.com:8443';
    assert.equal(settings().production, true);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('demo seeding cannot create a password that the sign-in contract rejects', async () => {
  const password = process.env.DEMO_PASSWORD;
  try {
    process.env.DEMO_PASSWORD = 'x'.repeat(129);
    await assert.rejects(seed(app.get(Database)), /12–128 characters/);
  } finally {
    process.env.DEMO_PASSWORD = password;
  }
});
