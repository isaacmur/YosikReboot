// POST /api/login  { passphrase }  -> sets the session cookie
// DELETE /api/login                 -> clears it
// The only API route the middleware lets through without a session.

import { clearedSessionCookie, passphraseMatches, sessionCookie, signSession } from '../lib/auth/cookie.js';
import { authConfig } from '../lib/config.js';
import { apiError, json, toErrorResponse } from '../lib/http.js';

export async function POST(request: Request): Promise<Response> {
  try {
    const { passphrase, cookieSecret } = authConfig();
    let given: unknown;
    try {
      given = ((await request.json()) as { passphrase?: unknown }).passphrase;
    } catch {
      return apiError(400, 'bad_request', 'Send JSON: { "passphrase": "..." }');
    }
    if (typeof given !== 'string' || !(await passphraseMatches(given, passphrase))) {
      return apiError(401, 'wrong_passphrase', 'Wrong passphrase.');
    }
    return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(await signSession(cookieSecret)) } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export function DELETE(): Response {
  return json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie() } });
}
