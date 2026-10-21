import { describe, expect, it } from 'vitest';
import {
  basicAuthHeader,
  EpicTokenManager,
  exchangeToClient,
  requestToken,
  toEpicToken,
  type FetchLike,
} from '../lib/auth/epicToken';
import { EpicHttpError } from '../lib/epic/errors';

const client = { id: 'cid', secret: 'csecret' };
const device = { accountId: 'acc', deviceId: 'dev', secret: 'dsecret' };

function tokenServer(opts: { expiresIn?: number; fail?: number } = {}) {
  const requests: { url: string; init?: RequestInit }[] = [];
  let n = 0;
  const f: FetchLike = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/oauth/exchange')) return Response.json({ code: 'xchg' });
    if (opts.fail && n < opts.fail) {
      n += 1;
      return Response.json({ errorCode: 'errors.com.epicgames.account.invalid_account_credentials', errorMessage: 'bad' }, { status: 400 });
    }
    n += 1;
    return Response.json({ access_token: `tok${n}`, expires_in: opts.expiresIn ?? 7200, account_id: 'acc', client_id: 'cid' });
  };
  return { f, requests };
}

describe('requestToken', () => {
  it('POSTs a form-encoded grant with basic client auth', async () => {
    const { f, requests } = tokenServer();
    await requestToken(f, client, { grant_type: 'device_auth', account_id: 'acc' });
    const init = requests[0]!.init!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(basicAuthHeader(client));
    expect(basicAuthHeader(client)).toBe(`basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(init.body).toBe('grant_type=device_auth&account_id=acc');
  });

  it('throws EpicHttpError with Epic\'s error code', async () => {
    const { f } = tokenServer({ fail: 1 });
    const err = await requestToken(f, client, {}).catch((e) => e);
    expect(err).toBeInstanceOf(EpicHttpError);
    expect(err.status).toBe(400);
    expect(err.errorCode).toBe('errors.com.epicgames.account.invalid_account_credentials');
  });

  it('rejects a 200 without access_token', async () => {
    const f: FetchLike = async () => Response.json({});
    await expect(requestToken(f, client, {})).rejects.toThrow(/no access_token/);
  });
});

describe('exchangeToClient', () => {
  it('gets an exchange code with the bearer token, then redeems it with the target client', async () => {
    const { f, requests } = tokenServer();
    await exchangeToClient(f, 'first', { id: 'other', secret: 's' });
    expect((requests[0]!.init!.headers as Record<string, string>).Authorization).toBe('bearer first');
    expect(requests[1]!.init!.body).toBe('grant_type=exchange_code&exchange_code=xchg');
  });
});

describe('toEpicToken', () => {
  it('prefers expires_at and falls back to expires_in', () => {
    expect(toEpicToken({ access_token: 'a', expires_at: '2026-10-21T00:00:00.000Z' }, 'c', 0).expiresAt).toBe(
      Date.parse('2026-10-21T00:00:00.000Z'),
    );
    expect(toEpicToken({ access_token: 'a', expires_in: 10 }, 'c', 1000).expiresAt).toBe(11_000);
    expect(toEpicToken({ access_token: 'a', expires_at: 'garbage', expires_in: 10 }, 'c', 0).expiresAt).toBe(10_000);
  });
});

describe('EpicTokenManager', () => {
  it('memoises until the refresh margin, then re-mints', async () => {
    const { f, requests } = tokenServer({ expiresIn: 3600 });
    let now = 0;
    const m = new EpicTokenManager({ fetch: f, client, device, now: () => now, refreshMarginMs: 300_000 });
    expect((await m.get()).accessToken).toBe('tok1');
    now = 3_299_999;
    expect((await m.get()).accessToken).toBe('tok1');
    now = 3_300_000;
    expect((await m.get()).accessToken).toBe('tok2');
    expect(requests).toHaveLength(2);
    expect(requests[0]!.init!.body).toBe('grant_type=device_auth&account_id=acc&device_id=dev&secret=dsecret');
  });

  it('shares one mint between concurrent callers', async () => {
    const { f, requests } = tokenServer();
    const m = new EpicTokenManager({ fetch: f, client, device });
    const [a, b] = await Promise.all([m.get(), m.get()]);
    expect(a).toBe(b);
    expect(requests).toHaveLength(1);
  });

  it('re-mints after invalidate() (the 401 path)', async () => {
    const { f } = tokenServer();
    const m = new EpicTokenManager({ fetch: f, client, device });
    await m.get();
    m.invalidate();
    expect((await m.get()).accessToken).toBe('tok2');
  });

  it('counts consecutive failures and resets on success', async () => {
    const { f } = tokenServer({ fail: 3 });
    const m = new EpicTokenManager({ fetch: f, client, device });
    for (let i = 0; i < 3; i++) await expect(m.get()).rejects.toBeInstanceOf(EpicHttpError);
    expect(m.status().consecutiveFailures).toBe(3);
    expect(m.status().lastError).toBe('bad');
    await m.get();
    expect(m.status()).toMatchObject({ consecutiveFailures: 0, lastError: undefined });
  });

  it('exchanges into a second client when configured', async () => {
    const { f, requests } = tokenServer();
    const m = new EpicTokenManager({ fetch: f, client, device, exchangeClient: { id: 'evt', secret: 's' } });
    const t = await m.get();
    expect(t.accessToken).toBe('tok2');
    expect(requests.map((r) => r.url.split('/').pop())).toEqual(['token', 'exchange', 'token']);
  });
});
