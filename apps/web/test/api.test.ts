import { afterEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { request, ApiError } from '../src/api.js';

afterEach(() => mock.restoreAll());
test('non-JSON success is rejected so callers cannot discard unsaved work', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>Proxy error</html>', { status: 200 }),
  );
  await assert.rejects(
    request('/assignments'),
    (error: unknown) =>
      error instanceof ApiError && error.status === 502 && /Invalid response/.test(error.message),
  );
});
test('null and primitive success bodies are rejected', async () => {
  for (const body of [null, true, 123, 'ok']) {
    mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(request('/assignments'), { status: 502 });
    mock.restoreAll();
  }
});
test('a non-JSON failure retains its HTTP status and an actionable message', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('Proxy unavailable', { status: 503 }));
  await assert.rejects(request('/assignments'), { status: 503, message: 'Request failed (503).' });
});
test('JSON null error bodies do not throw a secondary TypeError', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(null, { status: 403 }));
  await assert.rejects(request('/assignments'), { status: 403, message: 'Request failed (403).' });
});
test('aborting while reading a response remains cancellation', async () => {
  const controller = new AbortController();
  mock.method(globalThis, 'fetch', async () => {
    const response = Response.json({ ok: true });
    mock.method(response, 'json', async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    return response;
  });
  await assert.rejects(request('/assignments', undefined, { signal: controller.signal }), {
    name: 'AbortError',
  });
});
test('successful JSON objects and collections are returned unchanged', async () => {
  for (const body of [{ ok: true }, [{ id: 'item' }]]) {
    mock.method(globalThis, 'fetch', async () => Response.json(body));
    assert.deepEqual(await request('/assignments'), body);
    mock.restoreAll();
  }
});
