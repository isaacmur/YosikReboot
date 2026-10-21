import {
  mintFromDeviceAuth,
  readJson,
  requestToken,
  type ClientCredentials,
  type DeviceAuth,
  type FetchLike,
} from '../lib/auth/epicToken';
import { endpoints } from '../lib/epic/endpoints';
import { EpicHttpError, parseEpicError } from '../lib/epic/errors';

export interface CreatedDeviceAuth {
  device: DeviceAuth;
  displayName?: string;
  /** True if minting a token from the new credentials worked. */
  verified: boolean;
}

/**
 * One-time setup: trade a browser authorization code for a token, create a
 * device auth for that account, then prove it works by minting from it.
 */
export async function createDeviceAuth(
  fetchImpl: FetchLike,
  client: ClientCredentials,
  authorizationCode: string,
): Promise<CreatedDeviceAuth> {
  const login = await requestToken(fetchImpl, client, {
    grant_type: 'authorization_code',
    code: authorizationCode.trim(),
  });
  const accountId = login.account_id;
  if (!accountId) throw new Error('Token response had no account_id');

  const url = endpoints.deviceAuth(accountId);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `bearer ${login.access_token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await readJson(res);
  if (!res.ok) {
    const { errorCode, errorMessage } = parseEpicError(body);
    throw new EpicHttpError(res.status, url, errorCode, errorMessage);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.deviceId !== 'string' || typeof b.secret !== 'string') {
    throw new Error('Device auth response had no deviceId/secret');
  }
  const device: DeviceAuth = {
    accountId: typeof b.accountId === 'string' ? b.accountId : accountId,
    deviceId: b.deviceId,
    secret: b.secret,
  };

  let verified = false;
  try {
    const check = await mintFromDeviceAuth(fetchImpl, client, device);
    verified = true;
    await killSession(fetchImpl, check.access_token);
  } catch {
    // Reported through `verified`.
  }
  await killSession(fetchImpl, login.access_token);

  return { device, displayName: typeof login.displayName === 'string' ? login.displayName : undefined, verified };
}

/** Best effort: end a session we no longer need. */
async function killSession(fetchImpl: FetchLike, accessToken: string): Promise<void> {
  try {
    await fetchImpl(endpoints.oauthKillSession(accessToken), {
      method: 'DELETE',
      headers: { Authorization: `bearer ${accessToken}` },
    });
  } catch {
    // Ignore; the token expires on its own.
  }
}
