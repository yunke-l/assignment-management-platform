import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const data = fileURLToPath(new URL('../.local/database', import.meta.url));
await mkdir(new URL('../.local', import.meta.url), { recursive: true });
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
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: root, env, stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    child.on('error', reject);
    child.on('exit', (code) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} exited with ${code}`));
    });
  });
}
await run(['run', 'db:migrate']);
await run(['run', 'db:seed']);
console.log(
  '\nLocal demo: http://localhost:5173\nTeacher: teacher@example.test\nStudent: student@example.test\nPassword: LocalStudy2026!\n',
);
await run(['run', 'dev']);
