import { endpoints } from '../epic/endpoints';
import { EpicHttpError, parseEpicError } from '../epic/errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientCredentials {
  id: string;
  secret: string;
}

export interface DeviceAuth {
  accountId: string;
  deviceId: string;
  secret: string;
}

/** The fields of Epic's OAuth token response this app relies on. */
export interface TokenResponse {
  access_token: string;
  expires_in?: number;
  expires_at?: string;
  account_id?: string;
  client_id?: string;
  displayName?: string;
  [key: string]: unknown;
}

export interface EpicToken {
  accessToken: string;
  accountId: string;
  clientId: string;
  /** Epoch ms. */
  expiresAt: number;
}

export function basicAuthHeader(client: ClientCredentials): string {
  return `basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`;
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** POSTs one OAuth grant and returns Epic's raw token response. */
export async function requestToken(
  fetchImpl: FetchLike,
  client: ClientCredentials,
  grant: Record<string, string>,
): Promise<TokenResponse> {
  const url = endpoints.oauthToken();
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(client),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(grant).toString(),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const { errorCode, errorMessage } = parseEpicError(body);
    throw new EpicHttpError(res.status, url, errorCode, errorMessage);
  }
  const token = body as TokenResponse | undefined;
  if (!token || typeof token.access_token !== 'string') {
    throw new EpicHttpError(res.status, url, undefined, 'Token response had no access_token');
  }
  return token;
}

export function mintFromDeviceAuth(fetchImpl: FetchLike, client: ClientCredentials, device: DeviceAuth) {
  return requestToken(fetchImpl, client, {
    grant_type: 'device_auth',
    account_id: device.accountId,
    device_id: device.deviceId,
    secret: device.secret,
  });
}

/** Trades a token from one client for a token from another client. */
export async function exchangeToClient(
  fetchImpl: FetchLike,
  accessToken: string,
  target: ClientCredentials,
): Promise<TokenResponse> {
  const url = endpoints.oauthExchange();
  const res = await fetchImpl(url, { headers: { Authorization: `bearer ${accessToken}` } });
  const body = await readJson(res);
  if (!res.ok) {
    const { errorCode, errorMessage } = parseEpicError(body);
    throw new EpicHttpError(res.status, url, errorCode, errorMessage);
  }
  const code = (body as { code?: unknown } | undefined)?.code;
  if (typeof code !== 'string') {
    throw new EpicHttpError(res.status, url, undefined, 'Exchange response had no code');
  }
  return requestToken(fetchImpl, target, { grant_type: 'exchange_code', exchange_code: code });
}

export function toEpicToken(raw: TokenResponse, fallbackClientId: string, now: number): EpicToken {
  const parsedAt = raw.expires_at ? Date.parse(raw.expires_at) : NaN;
  const expiresAt = Number.isFinite(parsedAt)
    ? parsedAt
    : now + (typeof raw.expires_in === 'number' ? raw.expires_in : 0) * 1000;
  return {
    accessToken: raw.access_token,
    accountId: raw.account_id ?? '',
    clientId: raw.client_id ?? fallbackClientId,
    expiresAt,
  };
}

export interface TokenManagerOptions {
  fetch?: FetchLike;
  client: ClientCredentials;
  device: DeviceAuth;
  /** If set, the device-auth token is exchanged into this client's token. */
  exchangeClient?: ClientCredentials;
  /** Re-mint this long before expiry. */
  refreshMarginMs?: number;
  now?: () => number;
}

export interface TokenStatus {
  mintedAt?: number;
  expiresAt?: number;
  lastError?: string;
  consecutiveFailures: number;
}

/**
 * Keeps one access token in memory, re-minting it shortly before expiry, after
 * invalidate() (call that on a 401), or on a cold start.
 */
export class EpicTokenManager {
  private token?: EpicToken;
  private pending?: Promise<EpicToken>;
  private readonly st: TokenStatus = { consecutiveFailures: 0 };
  private readonly fetchImpl: FetchLike;
  private readonly margin: number;
  private readonly now: () => number;

  constructor(private readonly opts: TokenManagerOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.margin = opts.refreshMarginMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  async get(): Promise<EpicToken> {
    if (this.token && this.now() < this.token.expiresAt - this.margin) return this.token;
    // Concurrent callers share one mint.
    this.pending ??= this.mint().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  invalidate(): void {
    this.token = undefined;
  }

  status(): TokenStatus {
    return { ...this.st };
  }

  private async mint(): Promise<EpicToken> {
    const { client, device, exchangeClient } = this.opts;
    try {
      let raw = await mintFromDeviceAuth(this.fetchImpl, client, device);
      let clientId = client.id;
      if (exchangeClient) {
        raw = await exchangeToClient(this.fetchImpl, raw.access_token, exchangeClient);
        clientId = exchangeClient.id;
      }
      const now = this.now();
      this.token = toEpicToken(raw, clientId, now);
      this.st.mintedAt = now;
      this.st.expiresAt = this.token.expiresAt;
      this.st.lastError = undefined;
      this.st.consecutiveFailures = 0;
      return this.token;
    } catch (err) {
      this.token = undefined;
      this.st.lastError = err instanceof Error ? err.message : String(err);
      this.st.consecutiveFailures += 1;
      throw err;
    }
  }
}
