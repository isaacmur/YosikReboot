// Browser side of the API: typed fetches, a short in-memory cache, and a
// redirect to /login whenever a route answers 401.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

export class AuthError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<Error> {
  if (res.status === 401) return new AuthError('Sign in first.');
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(res.status, body.error?.code ?? 'unknown', body.error?.message ?? `HTTP ${res.status}`);
  } catch {
    return new ApiError(res.status, 'unknown', `HTTP ${res.status}`);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export async function login(passphrase: string): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) throw await failure(res);
}

export async function logout(): Promise<void> {
  await fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' });
  cache.clear();
}

const cache = new Map<string, { at: number; data: unknown }>();

interface ApiState<T> {
  data?: T;
  error?: Error;
  loading: boolean;
}

/** Fetches `path` (null = skip), reusing a copy younger than `maxAgeMs`. 401 sends you to /login. */
export function useApi<T>(path: string | null, maxAgeMs = 60_000): ApiState<T> & { reload: () => void } {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location.pathname + location.search);
  here.current = location.pathname + location.search;
  const [force, setForce] = useState(0);
  const [state, setState] = useState<ApiState<T>>(() => {
    const hit = path ? cache.get(path) : undefined;
    return hit ? { data: hit.data as T, loading: false } : { loading: path !== null };
  });

  useEffect(() => {
    if (!path) return;
    const hit = cache.get(path);
    if (hit && force === 0 && Date.now() - hit.at < maxAgeMs) {
      setState({ data: hit.data as T, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ data: hit ? (hit.data as T) : s.data, loading: true }));
    apiGet<T>(path)
      .then((data) => {
        cache.set(path, { at: Date.now(), data });
        if (!cancelled) setState({ data, loading: false });
      })
      .catch((error: Error) => {
        if (cancelled) return;
        if (error instanceof AuthError) navigate('/login', { replace: true, state: { from: here.current } });
        else setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, force, maxAgeMs, navigate]);

  return { ...state, reload: () => setForce((n) => n + 1) };
}
