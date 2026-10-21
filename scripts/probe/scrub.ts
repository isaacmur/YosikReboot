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
