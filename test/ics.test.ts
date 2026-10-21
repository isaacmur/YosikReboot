// The calendar feed (F5): iCalendar text, the route's two branches, and the
// middleware letting the feed through on its own token (D21).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEED_PAST_DAYS, makeIcsHandler } from '../api/ics';
import { EpicTokenManager, type FetchLike } from '../lib/auth/epicToken';
import { signSession, SESSION_COOKIE } from '../lib/auth/cookie';
import { EpicClient } from '../lib/epic/client';
import { normalizeEvents } from '../lib/epic/events';
import { clearScheduleCache } from '../lib/epic/schedule';
import { calendar, foldLine, icsText, icsTime } from '../lib/ics';
import type { CalendarFeed } from '../lib/types';
import middleware from '../middleware';

const DIR = join(__dirname, 'fixtures/epic/first');
const fixture = (f: string) => readFileSync(join(DIR, f), 'utf8');
const TOKEN = 'feed-token-0123456789abcdef';
const SECRET = 'test-cookie-secret-0123456789abcdef';
const NOW = Date.parse('2026-10-21T01:30:00Z');

describe('iCalendar text', () => {
  it('writes UTC times and escapes text', () => {
    expect(icsTime('2026-10-21T01:00:00Z')).toBe('20261021T010000Z');
    expect(icsTime('2026-10-21T01:00:00.123Z')).toBe('20261021T010000Z');
    expect(icsText('Cup, Round 2; a\\b\nnext')).toBe(String.raw`Cup\, Round 2\; a\\b\nnext`);
  });

  it('folds long lines at 75 bytes without splitting a character', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
    const long = `SUMMARY:${'é'.repeat(60)}`;
    const pieces = foldLine(long).split('\r\n');
    expect(pieces.length).toBeGreaterThan(1);
    for (const [i, p] of pieces.entries()) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(p.startsWith(' ')).toBe(true);
    }
    expect(pieces.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
  });

  it('builds a calendar with CRLF lines and one VEVENT per session', () => {
    const text = calendar({
      name: 'YosikReboot · NAE',
      description: 'Sessions',
      now: '2026-10-21T00:00:00Z',
      events: [
        { uid: 'w1@yosikreboot', start: '2026-10-21T01:00:00Z', end: '2026-10-21T03:00:00Z', summary: 'Cup, Event 1' },
        {
          uid: 'w2@yosikreboot',
          start: '2026-10-22T01:00:00Z',
          end: '2026-10-22T03:00:00Z',
          summary: 'TBD',
          tentative: true,
        },
      ],
    });
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain('SUMMARY:Cup\\, Event 1');
    expect(text).toContain('STATUS:TENTATIVE');
    expect(text).toContain('DTSTART:20261021T010000Z');
  });
});

function epic() {
  const f: FetchLike = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/account/api/oauth/token') return Response.json({ access_token: 't', expires_in: 7200 });
    if (u.pathname.startsWith('/api/v1/events/Fortnite/download/'))
      return new Response(fixture(`events-download-${u.searchParams.get('region')}.json`));
    if (u.pathname.includes('tournamentinformation')) return new Response(fixture('cms-tournamentinformation.json'));
    return new Response('{}', { status: 404 });
  };
  return new EpicClient({
    tokens: new EpicTokenManager({
      fetch: f,
      client: { id: 'c', secret: 's' },
      device: { accountId: 'svc', deviceId: 'd', secret: 's' },
    }),
    fetch: f,
    minGapMs: 0,
  });
}

describe('GET /api/ics', () => {
  beforeEach(() => clearScheduleCache());
  /** `null`: ICS_TOKEN unset. */
  const handler = (token: string | null = TOKEN) => {
    const client = epic();
    return makeIcsHandler({
      client: () => client,
      accountId: () => 'svc',
      now: () => NOW,
      token: () => token ?? undefined,
      cookieSecret: () => SECRET,
    });
  };
  const get = (h: ReturnType<typeof makeIcsHandler>, q: string, cookie?: string) =>
    h(
      new Request(`https://app.test/api/ics${q}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} }),
    );

  it("serves a region's sessions from two weeks back onward, CDN-cached 15 minutes", async () => {
    const res = await get(handler(), `?token=${TOKEN}&region=NAE`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('vercel-cdn-cache-control')).toMatch(/max-age=900/);
    const text = await res.text();
    const since = NOW - FEED_PAST_DAYS * 86_400_000;
    const expected = normalizeEvents(JSON.parse(fixture('events-download-NAE.json')), new Map())
      .flatMap((e) => e.windows)
      .filter((w) => Date.parse(w.end) >= since);
    expect(expected.length).toBeGreaterThan(10);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(expected.length);
    expect(text).toContain('X-WR-CALNAME:YosikReboot · NAE');
    // Links go back to the app that served the feed.
    expect(text).toMatch(/URL:https:\/\/app\.test\/events\//);
  });

  it('filters by event type and rejects bad input', async () => {
    const all = await (await get(handler(), `?token=${TOKEN}&region=NAC`)).text();
    const cash = await (await get(handler(), `?token=${TOKEN}&region=NAC&type=CASH_CUP`)).text();
    expect(cash.match(/BEGIN:VEVENT/g)!.length).toBeLessThan(all.match(/BEGIN:VEVENT/g)!.length);
    expect(cash).toContain('Cash Cup');
    expect((await get(handler(), `?token=${TOKEN}&region=MARS`)).status).toBe(400);
    expect((await get(handler(), `?token=${TOKEN}&type=NOPE`)).status).toBe(400);
  });

  it('refuses a wrong token, and every token while the feed is off', async () => {
    expect((await get(handler(), '?token=nope&region=NAE')).status).toBe(401);
    expect((await get(handler(null), `?token=${TOKEN}&region=NAE`)).status).toBe(401);
    expect((await get(handler('short'), '?token=short&region=NAE')).status).toBe(401);
  });

  it('gives the signed-in app the token for its subscribe link, uncached', async () => {
    expect((await get(handler(), '')).status).toBe(401);
    const cookie = await signSession(SECRET);
    const res = await get(handler(), '', cookie);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()) as CalendarFeed).toEqual({ token: TOKEN });
    expect(await (await get(handler(null), '', cookie)).json()).toEqual({ token: null });
    expect(await (await get(handler('too-short'), '', cookie)).json()).toEqual({ token: null });
  });
});

describe('middleware and the calendar feed', () => {
  afterEach(() => vi.unstubAllEnvs());
  const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

  it('lets the feed through on its own token, without a session', async () => {
    vi.stubEnv('COOKIE_SECRET', SECRET);
    vi.stubEnv('ICS_TOKEN', TOKEN);
    expect(passes(await middleware(new Request(`https://app.test/api/ics?token=${TOKEN}&region=NAE`)))).toBe(true);
    const wrong = await middleware(new Request('https://app.test/api/ics?token=guess&region=NAE'));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('cache-control')).toBe('no-store');
    // The token opens the feed only, not other routes.
    expect((await middleware(new Request(`https://app.test/api/events?region=NAE&token=${TOKEN}`))).status).toBe(401);
  });

  it('keeps the feed closed while ICS_TOKEN is unset, and needs the session without a token', async () => {
    vi.stubEnv('COOKIE_SECRET', SECRET);
    vi.stubEnv('ICS_TOKEN', '');
    expect((await middleware(new Request('https://app.test/api/ics?token=&region=NAE'))).status).toBe(401);
    expect((await middleware(new Request('https://app.test/api/ics'))).status).toBe(401);
    const signedIn = new Request('https://app.test/api/ics', {
      headers: { cookie: `${SESSION_COOKIE}=${await signSession(SECRET)}` },
    });
    expect(passes(await middleware(signedIn))).toBe(true);
  });
});
