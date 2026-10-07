import 'reflect-metadata';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Database } from '../../src/database/database.js';

const db = new Database();
let originalPid: number;
async function waitForTermination(pid: number) {
  originalPid = pid;
  console.log(`READY ${pid}`);
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));
  // Give the terminated connection time to deliver its error event.
  await delay(100);
}
try {
  if (process.argv[2] === 'transaction') {
    await assert.rejects(
      db.transaction(async (tx) => {
        const [original] = await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        await waitForTermination(original!.pid);
        await tx.query('SELECT 1');
      }),
    );
  } else {
    const [original] = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await waitForTermination(original!.pid);
  }
  const [replacement] = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  assert.notEqual(replacement!.pid, originalPid!);
  console.log('RECOVERED');
} finally {
  await db.onModuleDestroy();
}
