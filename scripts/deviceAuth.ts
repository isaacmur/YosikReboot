import {
  exchangeToClient,
  mintFromDeviceAuth,
  readJson,
  requestToken,
  type ClientCredentials,
  type DeviceAuth,
  type FetchLike,
  type TokenResponse,
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
  opts: { expectDisplayName?: string } = {},
): Promise<CreatedDeviceAuth> {
  const login = await requestToken(fetchImpl, client, {
    grant_type: 'authorization_code',
    code: authorizationCode.trim(),
  });
  return createDeviceAuthFromLogin(fetchImpl, client, login, opts.expectDisplayName);
}

export class WrongAccountError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string | undefined,
  ) {
    super(
      `Signed in as ${actual ?? 'an account with no display name'}, not ${expected}. ` +
        'Nothing was created; sign in as the right account and try again.',
    );
    this.name = 'WrongAccountError';
  }
}

/** Creates a device auth with a signed-in token from `client`, verifies it, and ends the login session. */
export async function createDeviceAuthFromLogin(
  fetchImpl: FetchLike,
  client: ClientCredentials,
  login: TokenResponse,
  expectDisplayName?: string,
): Promise<CreatedDeviceAuth> {
  const accountId = login.account_id;
  if (!accountId) throw new Error('Token response had no account_id');
  const displayName = typeof login.displayName === 'string' ? login.displayName : undefined;
  if (expectDisplayName && displayName?.toLowerCase() !== expectDisplayName.toLowerCase()) {
    await killSession(fetchImpl, login.access_token);
    throw new WrongAccountError(expectDisplayName, displayName);
  }

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

  return { device, displayName, verified };
}

// --- Device code ("open this link and approve") ------------------------------

export interface DeviceCodeLogin {
  /** Open this, sign in, approve. */
  verificationUrl: string;
  userCode: string;
  deviceCode: string;
  /** Epoch ms after which the code is dead. */
  expiresAt: number;
  intervalMs: number;
}

const PENDING = 'errors.com.epicgames.account.oauth.authorization_pending';
const SLOW_DOWN = 'errors.com.epicgames.account.oauth.slow_down';

/** Asks Epic for a link the account owner opens and approves; no password or code passes through us. */
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

/** Polls until the owner approves the link, then returns the signed-in token (from `codeClient`). */
export async function waitForDeviceCodeLogin(
  fetchImpl: FetchLike,
  codeClient: ClientCredentials,
  login: DeviceCodeLogin,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<TokenResponse> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  let interval = login.intervalMs;
  while (now() < login.expiresAt) {
    await sleep(interval);
    try {
      return await requestToken(fetchImpl, codeClient, { grant_type: 'device_code', device_code: login.deviceCode });
    } catch (err) {
      if (!(err instanceof EpicHttpError)) throw err;
      if (err.errorCode === SLOW_DOWN) interval += 5000;
      else if (err.errorCode !== PENDING) throw err;
    }
  }
  throw new Error('The sign-in link expired before it was approved. Run the command again for a new link.');
}

/**
 * Full link flow: approve on any device -> exchange the login into `client`
 * (the client the app runs with) -> create and verify a device auth there.
 */
export async function createDeviceAuthByLink(
  fetchImpl: FetchLike,
  client: ClientCredentials,
  codeClient: ClientCredentials,
  onLink: (login: DeviceCodeLogin) => void,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => number; expectDisplayName?: string } = {},
): Promise<CreatedDeviceAuth> {
  const login = await startDeviceCodeLogin(fetchImpl, codeClient, opts.now);
  onLink(login);
  const codeToken = await waitForDeviceCodeLogin(fetchImpl, codeClient, login, opts);
  const appToken =
    codeClient.id === client.id ? codeToken : await exchangeToClient(fetchImpl, codeToken.access_token, client);
  if (appToken !== codeToken) await killSession(fetchImpl, codeToken.access_token);
  return createDeviceAuthFromLogin(fetchImpl, client, appToken, opts.expectDisplayName);
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
