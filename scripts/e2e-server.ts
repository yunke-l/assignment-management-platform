import 'reflect-metadata';
import { ThrottlerStorage } from '@nestjs/throttler';
import { createApp } from '../apps/api/src/app.js';
import { Database } from '../apps/api/src/database/database.js';
import { migrate } from '../apps/api/src/database/migrate.js';
import { seed } from '../apps/api/src/database/seed.js';
// Isolated from both the user's local demo directory and any .env database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_DRIVER = 'pglite';
process.env.DATABASE_URL = 'memory://';
process.env.ALLOW_DEMO_SEED = 'true';
process.env.DEMO_PASSWORD = 'LocalStudy2026!';
process.env.WEB_ORIGIN = 'http://127.0.0.1:5175';
async function main() {
  const app = await createApp(true);
  // Every browser test shares loopback. Allow its burst of synthetic sign-ins in
  // this in-memory server only; production and HTTP-test limits stay unchanged.
  const limiter = app.get<ThrottlerStorage>(ThrottlerStorage);
  const increment = limiter.increment.bind(limiter);
  limiter.increment = (key, ttl, limit, blockDuration, name) =>
    increment(key, ttl, Math.max(limit, 1000), blockDuration, name);
  const db = app.get(Database);
  await migrate(db);
  await seed(db);
  await app.listen(3111, '127.0.0.1');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
