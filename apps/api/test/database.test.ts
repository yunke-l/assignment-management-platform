import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

for (const mode of ['idle', 'transaction']) {
  test(
    `a ${mode} PostgreSQL connection failure is handled and the next query reconnects`,
    {
      skip: !process.env.TEST_DATABASE_URL,
      timeout: 15000,
    },
    async (context) => {
      const root = fileURLToPath(new URL('../../../', import.meta.url));
      const child = spawn(
        process.execPath,
        [
          `${root}node_modules/tsx/dist/cli.mjs`,
          '--tsconfig',
          `${root}apps/api/tsconfig.json`,
          fileURLToPath(new URL('./fixtures/pool-probe.ts', import.meta.url)),
          mode,
        ],
        {
          cwd: root,
          signal: context.signal,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_DRIVER: 'postgres',
            DATABASE_URL: process.env.TEST_DATABASE_URL,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let output = '',
        errors = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        errors += chunk;
      });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once('close', resolve);
        child.once('error', reject);
      });
      const ready = new Promise<number>((resolve, reject) => {
        child.stdout.on('data', (chunk: string) => {
          output += chunk;
          const pid = output.match(/READY (\d+)/)?.[1];
          if (pid) resolve(Number(pid));
        });
        child.once('error', reject);
        child.once('close', () =>
          reject(new Error(`Database probe exited before readiness: ${errors}`)),
        );
      });
      const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      try {
        const pid = await ready;
        await control.connect();
        await control.query('SELECT pg_terminate_backend($1)', [pid]);
        child.stdin.end('check\n');
        assert.equal(await exited, 0, errors);
        assert.match(output, /RECOVERED/);
      } finally {
        child.kill();
        await control.end();
        await exited;
      }
    },
  );
}
