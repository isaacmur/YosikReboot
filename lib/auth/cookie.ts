// Session cookie for the passphrase gate. Web Crypto only, so the same code runs
// in Vercel's Edge middleware, in Node functions and in tests.
//
// Token format: `v1.<issuedAtMs>.<base64url HMAC-SHA256(secret, "v1.<issuedAtMs>")>`

export const SESSION_COOKIE = 'yr_session';
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
/** Tolerated clock skew for tokens issued "in the future". */
const MAX_SKEW_MS = 5 * 60_000;

const enc = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return base64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Compares two strings in time that depends only on their length. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hashes both sides first, so the comparison leaks nothing about length either. */
export async function passphraseMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all(
    [given, expected].map(async (s) => base64url(await crypto.subtle.digest('SHA-256', enc.encode(s)))),
  );
  return constantTimeEqual(a!, b!);
}

/** Shortest calendar feed token accepted; anything shorter leaves the feed off. */
export const MIN_FEED_TOKEN = 16;

/**
 * The calendar feed's secret (ICS_TOKEN, D21). Calendar apps can't send the session
 * cookie, so the feed URL carries this instead. Never matches while the feed is off.
 */
export async function feedTokenMatches(given: string | null, expected: string | undefined): Promise<boolean> {
  if (!given || !expected || expected.length < MIN_FEED_TOKEN) return false;
  return passphraseMatches(given, expected);
}

export async function signSession(secret: string, now = Date.now()): Promise<string> {
  if (!secret) throw new Error('signSession needs a non-empty secret');
  const payload = `v1.${now}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const m = /^v1\.(\d{1,16})\.([\w-]+)$/.exec(token);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (issuedAt > now + MAX_SKEW_MS || now - issuedAt > SESSION_MAX_AGE_S * 1000) return false;
  return constantTimeEqual(m[2]!, await hmac(secret, `v1.${m[1]}`));
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_S}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** True if the request carries a valid session cookie. */
export function isAuthorized(request: Request, secret: string | undefined, now = Date.now()): Promise<boolean> {
  return verifySession(readCookie(request.headers.get('cookie'), SESSION_COOKIE), secret ?? '', now);
}
