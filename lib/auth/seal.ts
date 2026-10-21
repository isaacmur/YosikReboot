// Sealed cookie values (D30): AES-256-GCM with a key derived from COOKIE_SECRET,
// so a short-lived Epic sign-in can ride in an HttpOnly cookie between the sync
// route's requests without the browser (or anything else) being able to read it,
// and without the server storing anything. Web Crypto only.
//
// Format: `v1.<base64url iv>.<base64url ciphertext>`; the payload carries its own expiry.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keyFor(secret: string, purpose: string): Promise<CryptoKey> {
  if (!secret) throw new Error('Sealing needs a non-empty secret');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`yr-seal-v1:${purpose}:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypts `value` until `expiresAt` (epoch ms). `purpose` keeps keys for different cookies apart. */
export async function seal(value: unknown, secret: string, purpose: string, expiresAt: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify({ exp: expiresAt, value }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret, purpose), data));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

/** The sealed value, or undefined if it's missing, tampered with, sealed for something else, or expired. */
export async function unseal<T>(
  token: string | undefined,
  secret: string,
  purpose: string,
  now = Date.now(),
): Promise<T | undefined> {
  const m = token ? /^v1\.([\w-]+)\.([\w-]+)$/.exec(token) : null;
  if (!m) return undefined;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64url(m[1]!) },
      await keyFor(secret, purpose),
      fromB64url(m[2]!),
    );
    const { exp, value } = JSON.parse(dec.decode(plain)) as { exp: number; value: T };
    return typeof exp === 'number' && now < exp ? value : undefined;
  } catch {
    return undefined;
  }
}
