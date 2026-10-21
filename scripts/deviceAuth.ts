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
import { killSession, pollDeviceCode, startDeviceCodeLogin, type DeviceCodeLogin } from '../lib/auth/deviceCode';
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
    const poll = await pollDeviceCode(fetchImpl, codeClient, login.deviceCode);
    if (poll.status === 'approved') return poll.token;
    if (poll.status === 'slow_down') interval += 5000;
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

export { startDeviceCodeLogin, type DeviceCodeLogin };
