import { describe, expect, it } from 'vitest';
import { EpicTokenManager, type FetchLike } from '../lib/auth/epicToken';
import { ConfigError } from '../lib/config';
import { CallLog, EpicClient } from '../lib/epic/client';
import { EpicHttpError } from '../lib/epic/errors';
import { apiError, cdnCacheHeaders, toErrorResponse } from '../lib/http';

const client = { id: 'cid', secret: 'cs' };
const device = { accountId: 'acc', deviceId: 'dev', secret: 'ds' };

/** Synthetic Epic: token endpoint mints tok1, tok2, …; data URLs answer per `routes`. */
function fakeEpic(routes: Record<string, (auth: string | null, n: number) => Response>) {
  let minted = 0;
  const hits: Record<string, number> = {};
  const seen: { url: string; auth: string | null }[] = [];
  const f: FetchLike = async (url, init) => {
    if (url.endsWith('/account/api/oauth/token')) {
      minted += 1;
      return Response.json({ access_token: `tok${minted}`, expires_in: 7200, account_id: 'acc' });
    }
    const auth = new Headers(init?.headers).get('authorization');
    seen.push({ url, auth });
    const key = new URL(url).pathname;
    hits[key] = (hits[key] ?? 0) + 1;
    const route = routes[key];
    if (!route) return Response.json({ errorCode: 'errors.com.epicgames.common.not_found' }, { status: 404 });
    return route(auth, hits[key]!);
  };
  return { f, seen, minted: () => minted };
}

function makeClient(f: FetchLike, waits: number[] = []) {
  return new EpicClient({
    tokens: new EpicTokenManager({ fetch: f, client, device }),
    fetch: f,
    minGapMs: 1000,
    sleep: async (ms) => void waits.push(ms),
  });
}

describe('EpicClient', () => {
  it('sends the bearer token and logs the call', async () => {
    const { f, seen } = fakeEpic({ '/data': () => Response.json({ ok: 1 }) });
    const c = makeClient(f);
    expect(await c.getJson('https://epic.test/data', 'data')).toEqual({ ok: 1 });
    expect(seen[0]!.auth).toBe('bearer tok1');
    expect(c.log.recent()).toMatchObject([{ label: 'data', status: 200 }]);
  });

  it('re-mints and retries once after a 401', async () => {
    const { f, seen, minted } = fakeEpic({
      '/data': (auth) => (auth === 'bearer tok1' ? new Response('{}', { status: 401 }) : Response.json({ ok: 2 })),
    });
    const c = makeClient(f);
    expect(await c.getJson('https://epic.test/data', 'data')).toEqual({ ok: 2 });
    expect(minted()).toBe(2);
    expect(seen.map((s) => s.auth)).toEqual(['bearer tok1', 'bearer tok2']);
    expect(c.log.recent().map((e) => e.label)).toEqual(['data (retry)', 'data']);
  });

  it('gives up after the retry also gets a 401', async () => {
    const { f } = fakeEpic({ '/data': () => new Response('{}', { status: 401 }) });
    const err = await makeClient(f)
      .getJson('https://epic.test/data', 'data')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EpicHttpError);
    expect((err as EpicHttpError).status).toBe(401);
  });

  it("throws Epic's error code and records it", async () => {
    const { f } = fakeEpic({});
    const c = makeClient(f);
    const err = await c.getJson('https://epic.test/missing', 'missing').catch((e) => e);
    expect(err).toMatchObject({ status: 404, errorCode: 'errors.com.epicgames.common.not_found' });
    expect(c.log.recent()[0]).toMatchObject({ status: 404, errorCode: 'errors.com.epicgames.common.not_found' });
    expect(c.log.consecutiveFailures).toBe(1);
  });

  it('logs network failures and rethrows them', async () => {
    const tokenOnly = fakeEpic({}).f;
    const f: FetchLike = async (url, init) => {
      if (url.endsWith('/oauth/token')) return tokenOnly(url, init);
      throw new TypeError('fetch failed');
    };
    const c = makeClient(f);
    await expect(c.getJson('https://epic.test/data', 'data')).rejects.toThrow('fetch failed');
    expect(c.log.recent()[0]).toMatchObject({ status: 0, errorCode: 'network' });
  });

  it('skips the token for public endpoints', async () => {
    const { f, seen, minted } = fakeEpic({ '/cms': () => Response.json({}) });
    await makeClient(f).getJson('https://epic.test/cms', 'cms', { auth: false });
    expect(seen[0]!.auth).toBeNull();
    expect(minted()).toBe(0);
  });

  it('spaces calls at least minGapMs apart, including concurrent ones', async () => {
    const { f } = fakeEpic({ '/a': () => Response.json({}) });
    const waits: number[] = [];
    const c = makeClient(f, waits);
    await Promise.all([1, 2, 3].map(() => c.getJson('https://epic.test/a', 'a')));
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThan(900);
    expect(waits[1]).toBeGreaterThan(1900);
  });
});

describe('CallLog', () => {
  it('keeps the newest N and counts failures in a row', () => {
    const log = new CallLog(2);
    for (const status of [500, 0, 200, 503, 404]) log.add({ at: '', label: `s${status}`, status, ms: 1 });
    expect(log.recent().map((e) => e.status)).toEqual([404, 503]);
    expect(log.consecutiveFailures).toBe(2);
  });
});

describe('HTTP helpers', () => {
  const body = async (r: Response) => (await r.json()) as { error: { code: string; upstreamStatus?: number } };

  it('maps errors to uncached responses', async () => {
    const cases: [unknown, number, string][] = [
      [new ConfigError(['X']), 500, 'config'],
      [new EpicHttpError(429, 'u'), 503, 'epic_rate_limited'],
      [new EpicHttpError(403, 'u'), 502, 'epic_auth'],
      [new EpicHttpError(404, 'u'), 404, 'not_found'],
      [new EpicHttpError(500, 'u'), 502, 'epic_upstream'],
      [new TypeError('fetch failed'), 502, 'epic_unreachable'],
      [new Error('boom'), 500, 'internal'],
    ];
    for (const [err, status, code] of cases) {
      const res = toErrorResponse(err);
      expect([res.status, (await body(res)).error.code]).toEqual([status, code]);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect((await body(toErrorResponse(new EpicHttpError(500, 'u')))).error.upstreamStatus).toBe(500);
    expect((await body(apiError(400, 'x', 'y'))).error).toEqual({ code: 'x', message: 'y' });
  });

  it("caches on Vercel's CDN only, never in the browser", () => {
    expect(cdnCacheHeaders(900)).toEqual({
      'Cache-Control': 'private, no-store',
      'Vercel-CDN-Cache-Control': 'max-age=900, stale-while-revalidate=300',
    });
    expect(cdnCacheHeaders(30)['Vercel-CDN-Cache-Control']).toBe('max-age=30, stale-while-revalidate=30');
  });
});
