import { useEffect, useState } from 'react';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    init.signal?.throwIfAborted();
    if (response.ok) throw new ApiError('Invalid response from the server. Please retry.', 502);
  }
  init.signal?.throwIfAborted();
  if (!response.ok) {
    if (
      response.status === 401 &&
      !['/auth/login', '/auth/register', '/auth/password', '/auth/me'].includes(path)
    )
      window.dispatchEvent(new Event('session-expired'));
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  if (!body || typeof body !== 'object')
    throw new ApiError('Invalid response from the server. Please retry.', 502);
  return body as T;
}
export function useResource<T>(path: string | null, token: string, revision = 0) {
  const key = JSON.stringify([path, token, revision]);
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string;
    key: string;
  }>({
    key,
    data: null,
    loading: false,
    error: '',
  });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, data: null, loading: !!path, error: '' });
    if (path)
      request<T>(path, token, { signal: controller.signal }).then(
        (data) => {
          if (!controller.signal.aborted) setState({ key, data, loading: false, error: '' });
        },
        (error) => {
          if (!controller.signal.aborted)
            setState({ key, data: null, loading: false, error: error.message });
        },
      );
    return () => controller.abort();
  }, [path, token, revision, key]);
  return state.key === key ? state : { data: null, loading: !!path, error: '' };
}
