// Fixtures get committed, so anything credential-like is removed before a
// response is written to disk: by key name, and by value for known secrets.

const SECRET_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'secret',
  'device_secret',
  'deviceid',
  'device_id',
  'exchange_code',
  'password',
  'authorization',
]);

export const REDACTED = '[redacted]';

/** Secrets shorter than this are not substituted by value (too likely to collide). */
const MIN_SECRET_LENGTH = 8;

export function scrub(value: unknown, secrets: readonly (string | undefined)[] = []): unknown {
  const known = secrets.filter((s): s is string => !!s && s.length >= MIN_SECRET_LENGTH);
  return walk(value, known);
}

function walk(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const s of secrets) out = out.split(s).join(REDACTED);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, secrets));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : walk(v, secrets);
    }
    return out;
  }
  return value;
}

/** Account lookups return profile data; fixtures keep only these fields' values. */
const ACCOUNT_KEEP = new Set(['id', 'displayName']);

/**
 * Account lookups (by name, bulk) include email, real name, country and linked
 * platform accounts. Keep `id` and `displayName`; every other field keeps its key
 * with the value redacted, so the response shape stays visible.
 */
export function sanitizeAccount(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAccount);
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  if (typeof o.errorCode === 'string') return o; // an error body, not an account
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = ACCOUNT_KEEP.has(k) ? v : REDACTED;
  return out;
}

/** Fields of the service account's own token response that are personal, not technical. */
const TOKEN_PERSONAL = new Set(['country']);

export function sanitizeToken(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = TOKEN_PERSONAL.has(k) ? REDACTED : v;
  return out;
}
