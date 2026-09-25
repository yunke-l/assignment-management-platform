import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function assertPortsAvailable(ports, host = '127.0.0.1') {
  const results = await Promise.allSettled(
    ports.map(
      (port) =>
        new Promise((resolve, reject) => {
          const server = createServer();
          server.once('error', reject);
          server.listen({ host, port, exclusive: true }, () => server.close(resolve));
        }),
    ),
  );
  const busy = ports.filter(
    (_, index) =>
      results[index].status === 'rejected' && results[index].reason.code === 'EADDRINUSE',
  );
  if (busy.length) {
    throw new Error(
      `Cannot start the local demo: port(s) ${busy.join(', ')} already in use.\n` +
        'If Classwork is already running, open http://localhost:5173.\n' +
        'To restart it, stop the existing server with Ctrl+C in its terminal, then run npm run dev:demo again.\n' +
        'No migrations or demo seed were run.',
    );
  }
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

// npm starts several descendants (concurrently, tsx, Vite). Terminating only npm
// can leave those descendants holding the development ports and database open.
export async function runCommand(command, args, { signal, ...options } = {}) {
  signal?.throwIfAborted();
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, exitSignal) => resolve({ code, exitSignal }));
  });
  let stopping;
  const stop = () => {
    stopping ??= (async () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise((resolve, reject) => {
          const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
          taskkill.once('error', reject);
          taskkill.once('close', resolve);
        });
        return;
      }
      if (!signalGroup(child.pid, 'SIGTERM')) return;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!signalGroup(child.pid, 0)) return;
        await delay(50);
      }
      signalGroup(child.pid, 'SIGKILL');
    })();
    return stopping;
  };
  // Observe cleanup rejection through the awaited finally block, not an event callback.
  const onAbort = () => void stop().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const { code, exitSignal } = await completed;
    if (!signal?.aborted && code !== 0) {
      throw new Error(
        `${command} ${args.join(' ')} exited with ${exitSignal ?? code}. See the output above for the original error.`,
      );
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await stop();
  }
  signal?.throwIfAborted();
}
