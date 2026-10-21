import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, POST } from '../api/login';
import {
  constantTimeEqual,
  passphraseMatches,
  readCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  signSession,
  verifySession,
} from '../lib/auth/cookie';
import middleware from '../middleware';

const SECRET = 'test-cookie-secret-0123456789abcdef';
const T0 = Date.parse('2026-10-21T12:00:00Z');

describe('session tokens', () => {
  it('verifies a token it signed, and rejects tampering or the wrong secret', async () => {
    const t = await signSession(SECRET, T0);
    expect(t).toMatch(/^v1\.\d+\.[\w-]+$/);
    expect(await verifySession(t, SECRET, T0)).toBe(true);
    expect(await verifySession(t, 'other-secret', T0)).toBe(false);
    expect(await verifySession(t.replace(`v1.${T0}`, `v1.${T0 + 1}`), SECRET, T0)).toBe(false);
    expect(await verifySession(`${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`, SECRET, T0)).toBe(false);
  });

  it('expires after 30 days and refuses tokens from the future', async () => {
    const t = await signSession(SECRET, T0);
    expect(await verifySession(t, SECRET, T0 + SESSION_MAX_AGE_S * 1000)).toBe(true);
    expect(await verifySession(t, SECRET, T0 + SESSION_MAX_AGE_S * 1000 + 1)).toBe(false);
    expect(await verifySession(await signSession(SECRET, T0 + 10 * 60_000), SECRET, T0)).toBe(false);
  });

  it('rejects malformed tokens and an empty secret', async () => {
    for (const bad of [undefined, '', 'v1', 'v2.1.abc', 'v1.abc.def', 'v1.1.a b']) {
      expect(await verifySession(bad, SECRET, T0)).toBe(false);
    }
    expect(await verifySession(await signSession(SECRET, T0), '', T0)).toBe(false);
    await expect(signSession('', T0)).rejects.toThrow(/non-empty secret/);
  });

  it('parses one cookie out of a header', () => {
    expect(readCookie('a=1; yr_session=v1.2.x; b=3', SESSION_COOKIE)).toBe('v1.2.x');
    expect(readCookie('yr_sessionx=1', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined();
  });

  it('compares passphrases exactly', async () => {
    expect(await passphraseMatches('abc-def', 'abc-def')).toBe(true);
    expect(await passphraseMatches('abc-deF', 'abc-def')).toBe(false);
    expect(await passphraseMatches('', 'abc')).toBe(false);
    expect(constantTimeEqual('ab', 'abc')).toBe(false);
  });
});

describe('POST/DELETE /api/login', () => {
  beforeEach(() => {
    vi.stubEnv('APP_PASSPHRASE', 'correct-horse');
    vi.stubEnv('COOKIE_SECRET', SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  const login = (body: string) =>
    POST(
      new Request('https://app.test/api/login', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      }),
    );

  it('sets a hardened session cookie for the right passphrase', async () => {
    const res = await login(JSON.stringify({ passphrase: 'correct-horse' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookie = res.headers.get('set-cookie')!;
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_MAX_AGE_S}`]) {
      expect(cookie).toContain(attr);
    }
    expect(await verifySession(readCookie(cookie, SESSION_COOKIE), SECRET)).toBe(true);
  });

  it('refuses a wrong passphrase without setting a cookie', async () => {
    const res = await login(JSON.stringify({ passphrase: 'wrong' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: { code: 'wrong_passphrase', message: 'Wrong passphrase.' } });
  });

  it('rejects bad bodies', async () => {
    expect((await login('not json')).status).toBe(400);
    expect((await login(JSON.stringify({ passphrase: 42 }))).status).toBe(401);
  });

  it('fails closed with a config error when secrets are missing', async () => {
    vi.stubEnv('COOKIE_SECRET', '');
    const res = await login(JSON.stringify({ passphrase: 'correct-horse' }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('config');
  });

  it('clears the cookie on DELETE', () => {
    expect(DELETE().headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('middleware', () => {
  afterEach(() => vi.unstubAllEnvs());
  const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';
  const req = (path: string, cookie?: string) =>
    new Request(`https://app.test${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

  it('lets /api/login through without a session', async () => {
    vi.stubEnv('COOKIE_SECRET', SECRET);
    expect(passes(await middleware(req('/api/login')))).toBe(true);
  });

  it('blocks every other API path without a valid session, uncached', async () => {
    vi.stubEnv('COOKIE_SECRET', SECRET);
    for (const path of ['/api/events?region=NAE', '/api/health', '/api/login/../events']) {
      const res = await middleware(req(path));
      expect(passes(res), path).toBe(false);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect((await middleware(req('/api/events', await signSession('other-secret')))).status).toBe(401);
  });

  it('passes a valid session through', async () => {
    vi.stubEnv('COOKIE_SECRET', SECRET);
    expect(passes(await middleware(req('/api/events', await signSession(SECRET))))).toBe(true);
  });

  it('fails closed when COOKIE_SECRET is not set', async () => {
    vi.stubEnv('COOKIE_SECRET', '');
    expect((await middleware(req('/api/events', await signSession(SECRET)))).status).toBe(401);
  });
});
