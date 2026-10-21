// Epic's device code sign-in ("open this link and approve"): the account owner
// approves on epicgames.com, so no password or code passes through this app.
// Used by the setup tool for the secondary account and by "Sync with Epic" for
// your own (D30).

import { endpoints } from '../epic/endpoints.js';
import { EpicHttpError, parseEpicError } from '../epic/errors.js';
import { readJson, requestToken, type ClientCredentials, type FetchLike, type TokenResponse } from './epicToken.js';

export interface DeviceCodeLogin {
  /** Open this, sign in, approve. */
  verificationUrl: string;
  userCode: string;
  deviceCode: string;
  /** Epoch ms after which the code is dead. */
  expiresAt: number;
  intervalMs: number;
}

export const AUTHORIZATION_PENDING = 'errors.com.epicgames.account.oauth.authorization_pending';
export const SLOW_DOWN = 'errors.com.epicgames.account.oauth.slow_down';

/** Asks Epic for a link the account owner opens and approves. */
export async function startDeviceCodeLogin(
  fetchImpl: FetchLike,
  codeClient: ClientCredentials,
  now: () => number = Date.now,
): Promise<DeviceCodeLogin> {
  const clientToken = await requestToken(fetchImpl, codeClient, { grant_type: 'client_credentials' });
  const url = endpoints.oauthDeviceAuthorization();
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${clientToken.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ prompt: 'login' }).toString(),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const { errorCode, errorMessage } = parseEpicError(body);
    throw new EpicHttpError(res.status, url, errorCode, errorMessage);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const userCode = typeof b.user_code === 'string' ? b.user_code : undefined;
  const deviceCode = typeof b.device_code === 'string' ? b.device_code : undefined;
  if (!userCode || !deviceCode) throw new Error('Device authorization response had no user_code/device_code');
  const verificationUrl =
    typeof b.verification_uri_complete === 'string'
      ? b.verification_uri_complete
      : `${typeof b.verification_uri === 'string' ? b.verification_uri : 'https://www.epicgames.com/activate'}?userCode=${encodeURIComponent(userCode)}`;
  const expiresIn = typeof b.expires_in === 'number' ? b.expires_in : 600;
  const interval = typeof b.interval === 'number' ? b.interval : 10;
  return { verificationUrl, userCode, deviceCode, expiresAt: now() + expiresIn * 1000, intervalMs: interval * 1000 };
}

export type DeviceCodePoll = { status: 'approved'; token: TokenResponse } | { status: 'pending' | 'slow_down' };

/** Asks once whether the link was approved. Anything but "not yet" (expired, declined) throws. */
export async function pollDeviceCode(
  fetchImpl: FetchLike,
  codeClient: ClientCredentials,
  deviceCode: string,
): Promise<DeviceCodePoll> {
  try {
    const token = await requestToken(fetchImpl, codeClient, { grant_type: 'device_code', device_code: deviceCode });
    return { status: 'approved', token };
  } catch (err) {
    if (err instanceof EpicHttpError && err.errorCode === AUTHORIZATION_PENDING) return { status: 'pending' };
    if (err instanceof EpicHttpError && err.errorCode === SLOW_DOWN) return { status: 'slow_down' };
    throw err;
  }
}

/** Best effort: end a session that's no longer needed, so its token stops working at once. */
export async function killSession(fetchImpl: FetchLike, accessToken: string): Promise<void> {
  try {
    await fetchImpl(endpoints.oauthKillSession(accessToken), {
      method: 'DELETE',
      headers: { Authorization: `bearer ${accessToken}` },
    });
  } catch {
    // Ignore; the token expires on its own.
  }
}
