import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../apps/api/dist/app.js';
import { Database } from '../apps/api/dist/database/database.js';
import { migrate } from '../apps/api/dist/database/migrate.js';
import { seed } from '../apps/api/dist/database/seed.js';
process.env.NODE_ENV = 'test';
process.env.SERVE_WEB = 'true';
process.env.DATABASE_DRIVER = 'pglite';
process.env.DATABASE_URL = 'memory://';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'BuiltSmokeTest123!';
const app = await createApp(true);
try {
  const db = app.get(Database);
  await migrate(db);
  await seed(db);
  const http = supertest(app.getHttpServer());
  const page = await http.get('/').expect(200);
  assert.match(page.headers['content-type'], /text\/html/);
  const asset = page.text.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset);
  await http.get(asset).expect(200);
  for (const path of [
    '/assignments?status=DRAFT&page=2',
    '/assignments/new',
    '/assignments/00000000-0000-4000-8000-000000000000',
    '/assignments/00000000-0000-4000-8000-000000000000/edit',
    '/classes',
    '/account',
  ]) {
    const clientPage = await http.get(path).set('Accept', 'text/html').expect(200);
    assert.match(clientPage.headers['content-type'], /text\/html/);
    assert.equal(clientPage.text, page.text);
  }
  await http.get('/api/not-a-route').expect(404);
  await http.get('/assets/not-a-file.js').expect(404);
  await http.get('/api/health').expect(200);
  const login = await http
    .post('/api/auth/login')
    .send({ email: 'teacher@example.test', password: process.env.DEMO_PASSWORD })
    .expect(201);
  await http.get('/api/classes').set('Authorization', `Bearer ${login.body.token}`).expect(200);
  console.log('Built Node entry, static web assets, migrations, login and database health passed.');
} finally {
  await app.close();
}
