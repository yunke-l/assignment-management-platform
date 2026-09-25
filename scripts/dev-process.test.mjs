import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { assertPortsAvailable, runCommand } from './dev-process.mjs';

async function listen(port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
async function close(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('an occupied port gives an actionable error and leaves its existing listener alone', async () => {
  const server = await listen();
  const { port } = server.address();
  try {
    await assert.rejects(assertPortsAvailable([port]), (error) => {
      assert.match(error.message, new RegExp(`port\\(s\\) ${port} already in use`));
      assert.match(error.message, /Ctrl\+C/);
      assert.match(error.message, /No migrations or demo seed were run/);
      return true;
    });
    assert.equal(server.listening, true);
  } finally {
    await close(server);
  }
});

test('successful preflight releases its probe socket for the real server', async () => {
  const probe = await listen();
  const { port } = probe.address();
  await close(probe);
  await assertPortsAvailable([port]);
  const realServer = await listen(port);
  await close(realServer);
});

test('a failed command reports its exit code', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }),
    /exited with 7.*original error/,
  );
});

test('an interrupted startup never launches its next command', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCommand('this-command-must-not-be-spawned', [], { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test(
  'stopping a command also releases ports held by its child and grandchild',
  { skip: process.platform === 'win32', timeout: 15000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'classwork-dev-process-'));
    const controller = new AbortController();
    const grandchild = `
      const { createServer } = require('node:net');
      const { writeFileSync } = require('node:fs');
      const server = createServer();
      server.listen(0, '127.0.0.1', () => writeFileSync(process.argv[1], JSON.stringify(server.address())));
    `;
    const parent = `
      const { spawn } = require('node:child_process');
      const { createServer } = require('node:net');
      const { writeFileSync } = require('node:fs');
      spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, process.argv[2]], { stdio: 'ignore' });
      const server = createServer();
      server.listen(0, '127.0.0.1', () => writeFileSync(process.argv[1], JSON.stringify(server.address())));
    `;
    const files = ['parent.json', 'grandchild.json'].map((name) => path.join(directory, name));
    const running = runCommand(process.execPath, ['-e', parent, ...files], {
      signal: controller.signal,
      stdio: 'ignore',
    });
    const stopped = assert.rejects(running, { name: 'AbortError' });
    try {
      const ports = [];
      for (const file of files) {
        const deadline = Date.now() + 5000;
        while (true) {
          try {
            ports.push(JSON.parse(await readFile(file, 'utf8')).port);
            break;
          } catch (error) {
            if (error.code !== 'ENOENT' || Date.now() >= deadline) throw error;
            await delay(20);
          }
        }
      }
      controller.abort();
      await stopped;
      for (const port of ports) {
        const replacement = await listen(port);
        await close(replacement);
      }
    } finally {
      controller.abort();
      await stopped;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
