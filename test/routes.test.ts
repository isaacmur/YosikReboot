import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeEventsHandler, SCHEDULE_CACHE_S } from '../api/events';
import { makeHealthHandler } from '../api/health';
import { EpicTokenManager, type FetchLike } from '../lib/auth/epicToken';
import { ConfigError } from '../lib/config';
import { EpicClient } from '../lib/epic/client';
import { cdnCacheHeaders } from '../lib/http';
import type { EventsResponse, HealthResponse } from '../lib/types';

const DIR = join(__dirname, 'fixtures/epic/first');
const fixture = (f: string) => readFileSync(join(DIR, f), 'utf8');
const device = { accountId: 'svc', deviceId: 'dev-id-123', secret: 'device-secret-xyz' };

/** Serves the anonymized capture for schedule and CMS calls; counts calls per kind. */
function epicFromFixtures(o: { tokenStatus?: number; eventsStatus?: number; cmsStatus?: number } = {}) {
  const calls = { token: 0, events: 0, cms: 0 };
  const f: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/account/api/oauth/token') {
      calls.token++;
      if (o.tokenStatus)
        return Response.json({ errorCode: 'errors.com.epicgames.account.invalid' }, { status: o.tokenStatus });
      return Response.json({ access_token: 'tok', expires_in: 7200, account_id: 'svc' });
    }
    if (path.startsWith('/api/v1/events/Fortnite/download/')) {
      calls.events++;
      if (o.eventsStatus) return new Response('{}', { status: o.eventsStatus });
      const region = new URL(url).searchParams.get('region');
      return new Response(fixture(`events-download-${region}.json`), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path.includes('tournamentinformation')) {
      calls.cms++;
      if (o.cmsStatus) return new Response('{}', { status: o.cmsStatus });
      return new Response(fixture('cms-tournamentinformation.json'));
    }
    return new Response('{}', { status: 404 });
  };
  const client = new EpicClient({
    tokens: new EpicTokenManager({ fetch: f, client: { id: 'c', secret: 's' }, device }),
    fetch: f,
    minGapMs: 0,
  });
  return { client, calls };
}

const get = (handler: (r: Request) => Promise<Response>, query: string) =>
  handler(new Request(`https://app.test/api/events${query}`));

describe('GET /api/events', () => {
  const deps = (client: EpicClient) => ({ client: () => client, accountId: () => 'svc', now: Date.now });

  it('returns the normalized schedule for a region, CDN-cached for 15 minutes and never browser-cached', async () => {
    const { client, calls } = epicFromFixtures();
    const res = await get(makeEventsHandler(deps(client)), '?region=NAE');
    expect(res.status).toBe(200);
    const want = cdnCacheHeaders(SCHEDULE_CACHE_S);
    expect(res.headers.get('cache-control')).toBe(want['Cache-Control']);
    expect(res.headers.get('vercel-cdn-cache-control')).toBe(want['Vercel-CDN-Cache-Control']);
    const body = (await res.json()) as EventsResponse;
    expect(body.region).toBe('NAE');
    expect(body.events).toHaveLength(32);
    expect(body.events.find((e) => e.id === 'epicgames_S42_PurgeCup_NAC')?.name).toBe('Lady Liberty Cup');
    expect(calls).toEqual({ token: 1, events: 1, cms: 1 });
  });

  it('is far smaller than what Epic sends', async () => {
    const { client } = epicFromFixtures();
    const res = await get(makeEventsHandler(deps(client)), '?region=NAC');
    const size = (await res.text()).length;
    expect(size).toBeLessThan(fixture('events-download-NAC.json').length / 10);
  });

  it('reuses the CMS copy for a day', async () => {
    const { client, calls } = epicFromFixtures();
    const handler = makeEventsHandler(deps(client));
    await get(handler, '?region=NAE');
    await get(handler, '?region=EU');
    expect(calls.cms).toBe(1);
    expect(calls.events).toBe(2);
  });

  it('still serves the schedule when the CMS is down', async () => {
    const { client } = epicFromFixtures({ cmsStatus: 500 });
    const res = await get(makeEventsHandler(deps(client)), '?region=EU');
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventsResponse;
    expect(body.events.find((e) => e.id === 'epicgames_S42_PurgeCup_EU')?.name).toBe('Purge Cup');
  });

  it('rejects unknown regions', async () => {
    const { client, calls } = epicFromFixtures();
    for (const q of ['', '?region=nae', '?region=MARS']) {
      const res = await get(makeEventsHandler(deps(client)), q);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(calls.events).toBe(0);
  });

  it('maps Epic failures to uncached errors', async () => {
    const { client } = epicFromFixtures({ eventsStatus: 503 });
    const res = await get(makeEventsHandler(deps(client)), '?region=NAE');
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('reports missing configuration', async () => {
    const res = await get(
      makeEventsHandler({
        client: () => {
          throw new ConfigError(['EPIC_DEVICE_SECRET']);
        },
        accountId: () => 'svc',
        now: Date.now,
      }),
      '?region=NAE',
    );
    expect(res.status).toBe(500);
  });
});

describe('GET /api/health', () => {
  const health = async (client: () => EpicClient) =>
    (await (await makeHealthHandler({ client, now: Date.now })()).json()) as HealthResponse;

  it('mints a token and reports ok, without leaking credentials', async () => {
    const { client } = epicFromFixtures();
    const res = await makeHealthHandler({ client: () => client, now: Date.now })();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    for (const secret of ['tok', device.secret, device.deviceId]) expect(text).not.toContain(`"${secret}"`);
    const body = JSON.parse(text) as HealthResponse;
    expect(body.status).toBe('ok');
    expect(body.token.expiresAt).toBeDefined();
  });

  it('shows recent upstream calls after a schedule request', async () => {
    const { client } = epicFromFixtures();
    await get(makeEventsHandler({ client: () => client, accountId: () => 'svc', now: Date.now }), '?region=NAE');
    const body = await health(() => client);
    expect(body.upstream.recent.map((c) => c.label).sort()).toEqual(['cms', 'events NAE']);
  });

  it('goes degraded, then down after three token failures in a row', async () => {
    const { client } = epicFromFixtures({ tokenStatus: 400 });
    expect((await health(() => client)).status).toBe('degraded');
    await health(() => client);
    const third = await health(() => client);
    expect(third.status).toBe('down');
    expect(third.token.consecutiveFailures).toBe(3);
  });

  it('names missing configuration without values', async () => {
    const body = await health(() => {
      throw new ConfigError(['EPIC_DEVICE_SECRET']);
    });
    expect(body).toMatchObject({ status: 'down', missingConfig: ['EPIC_DEVICE_SECRET'] });
  });
});
