import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertPortsAvailable, runCommand } from './dev-process.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const data = fileURLToPath(new URL('../.local/database', import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_DRIVER: 'pglite',
  DATABASE_URL: data,
  ALLOW_DEMO_SEED: 'true',
  DEMO_PASSWORD: 'LocalStudy2026!',
  PORT: '3100',
  HOST: '127.0.0.1',
  WEB_ORIGIN: 'http://localhost:5173',
};
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
async function run(args) {
  // npm_execpath also supports npm installations outside PATH and Windows npm.cmd.
  const npm = process.env.npm_execpath;
  await runCommand(npm ? process.execPath : 'npm', npm ? [npm, ...args] : args, {
    cwd: root,
    env,
    stdio: 'inherit',
    signal: controller.signal,
  });
}
try {
  // Check before opening the persistent PGlite directory in another process.
  await assertPortsAvailable([3100, 5173]);
  controller.signal.throwIfAborted();
  await mkdir(new URL('../.local', import.meta.url), { recursive: true });
  await run(['run', 'db:migrate']);
  await run(['run', 'db:seed']);
  console.log(
    '\nLocal demo: http://localhost:5173\nTeacher: teacher@example.test\nStudent: student@example.test\nPassword: LocalStudy2026!\n',
  );
  await run(['run', 'dev']);
} catch (error) {
  if (controller.signal.aborted) console.log('\nLocal demo stopped.');
  else {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  }
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
