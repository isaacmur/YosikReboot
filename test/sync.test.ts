// Sync with Epic (D30): sealed cookies, the device code sign-in, your own rows,
// and the session always ending at Epic.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSyncHandlers } from '../api/sync';
import { EpicTokenManager, type FetchLike } from '../lib/auth/epicToken';
import { seal, unseal } from '../lib/auth/seal';
import { EpicClient } from '../lib/epic/client';
import { playedSessions } from '../lib/epic/player';
import { clearScheduleCache } from '../lib/epic/schedule';
import type { SyncPoll, SyncProbe, SyncRows, SyncStart } from '../lib/types';

const fixture = (f: string) => readFileSync(join(__dirname, 'fixtures/epic/first', f), 'utf8');
const SECRET = 'test-cookie-secret-0123456789';

describe('sealed cookie values', () => {
  it('round-trips, and refuses tampering, another purpose and expiry', async () => {
    const sealed = await seal({ token: 'abc' }, SECRET, 'p', 2000);
    expect(sealed).not.toContain('abc');
    expect(await unseal(sealed, SECRET, 'p', 1000)).toEqual({ token: 'abc' });
    expect(await unseal(sealed, SECRET, 'other', 1000)).toBeUndefined();
    expect(await unseal(sealed, 'another-secret', 'p', 1000)).toBeUndefined();
    expect(await unseal(sealed, SECRET, 'p', 2000)).toBeUndefined();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(await unseal(tampered, SECRET, 'p', 1000)).toBeUndefined();
    expect(await unseal('junk', SECRET, 'p', 1000)).toBeUndefined();
  });
});

// The fixture board's 5th team stands in for you and your teammate.
const BOARD = JSON.parse(fixture('leaderboard-final-p0.json')) as { entries: { teamAccountIds: string[] }[] };
const [ME, MATE] = BOARD.entries[4]!.teamAccountIds as [string, string];
const SLENDER = { eventId: 'epicgames_S42_SlenderManCup_ZB_BR', windowId: 'S42_SlenderManCup_ZB_BR' };
const NOW = Date.parse('2026-10-21T03:00:00Z');

/** A fake Epic for the whole sync: device code sign-in, exchange, your schedule and your filtered rows. */
function fakeEpic(
  o: {
    pendingPolls?: number;
    teams?: Record<string, string[]>;
    history?: { status: number; body: unknown };
    /** Answer boards you're not on as Epic does for your own ID (200, no rows), instead of refusing. */
    emptyOnMiss?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const killed: string[] = [];
  let polls = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
    if (path === '/account/api/oauth/token') {
      const grant = new URLSearchParams(String(init?.body)).get('grant_type');
      calls.push(`token ${grant}`);
      if (grant === 'client_credentials') return Response.json({ access_token: 'client-token' });
      if (grant === 'device_code') {
        if (polls++ < (o.pendingPolls ?? 0))
          return Response.json(
            { errorCode: 'errors.com.epicgames.account.oauth.authorization_pending' },
            { status: 400 },
          );
        return Response.json({ access_token: 'switch-token', account_id: ME, displayName: 'You' });
      }
      if (grant === 'exchange_code')
        return Response.json({ access_token: 'your-token', account_id: ME, displayName: 'You', expires_in: 7200 });
      // The service account's device auth.
      return Response.json({ access_token: 'svc-token', account_id: 'svc', expires_in: 7200 });
    }
    if (path === '/account/api/oauth/deviceAuthorization')
      return Response.json({
        user_code: 'ABCD1234',
        device_code: 'device-code-secret',
        verification_uri_complete: 'https://www.epicgames.com/activate?userCode=ABCD1234',
        expires_in: 600,
        interval: 5,
      });
    if (path === '/account/api/oauth/exchange') return Response.json({ code: 'exchange-code' });
    if (path.startsWith('/account/api/oauth/sessions/kill/')) {
      killed.push(path.split('/').pop()!);
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('/api/v1/events/Fortnite/download/')) {
      const region = u.searchParams.get('region')!;
      const whose = path.split('/').pop();
      calls.push(`schedule ${whose === ME ? 'yours' : 'service'} ${region}`);
      if (whose === ME) {
        expect(auth).toBe('bearer your-token');
        const doc = JSON.parse(fixture(`events-download-${region}.json`)) as Record<string, unknown>;
        doc.player = { accountId: ME, tokens: [], teams: o.teams ?? {} };
        return Response.json(doc);
      }
      return new Response(fixture(`events-download-${region}.json`));
    }
    if (/^\/api\/v1\/events\/Fortnite\/[^/]+\/[^/]+\/history\//.test(path)) {
      calls.push('history');
      expect(auth).toBe('bearer your-token');
      return Response.json(o.history?.body ?? {}, { status: o.history?.status ?? 200 });
    }
    if (path.startsWith('/api/v1/leaderboards/Fortnite/')) {
      const [, instance, caller] = path.split('/').slice(5, 8) as [string, string, string];
      const team = u.searchParams.get('teamAccountIds') ?? '';
      calls.push(`row ${instance}`);
      expect(caller).toBe(ME);
      expect(auth).toBe('bearer your-token');
      const mine = BOARD.entries.find(
        (e) => [...e.teamAccountIds].sort().join(',') === team.split(',').sort().join(','),
      );
      if (instance === SLENDER.windowId && mine)
        return Response.json({ ...JSON.parse(fixture('leaderboard-final-p0.json')), entries: [mine] });
      if (o.emptyOnMiss) return Response.json({ ...JSON.parse(fixture('leaderboard-final-p0.json')), entries: [] });
      return Response.json({ errorCode: 'com.epicgames.api.malformed_data' }, { status: 400 });
    }
    return new Response('{}', { status: 404 });
  };
  const service = new EpicClient({
    tokens: new EpicTokenManager({
      fetch: fetchImpl,
      client: { id: 'c', secret: 's' },
      device: { accountId: 'svc', deviceId: 'd', secret: 's' },
    }),
    fetch: fetchImpl,
    minGapMs: 0,
  });
  const handlers = makeSyncHandlers({
    fetch: fetchImpl,
    serviceClient: () => service,
    serviceAccountId: () => 'svc',
    appClient: () => ({ id: 'app', secret: 's' }),
    codeClient: () => ({ id: 'switch', secret: 's' }),
    cookieSecret: () => SECRET,
    now: () => NOW,
    minGapMs: 0,
  });
  return { handlers, calls, killed };
}

const post = (step: string, cookie?: string, body?: unknown, q = '') =>
  new Request(`https://app.test/api/sync?step=${step}${q}`, {
    method: 'POST',
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;

/** Start, approve on the first poll, and return the signed-in cookie. */
async function signIn(epic: ReturnType<typeof fakeEpic>) {
  const start = await epic.handlers.POST(post('start'));
  const ready = await epic.handlers.POST(post('poll', cookieOf(start), undefined, '&region=BR'));
  return { ready, cookie: cookieOf(ready), body: (await ready.json()) as SyncPoll };
}

beforeEach(() => clearScheduleCache());

describe('POST /api/sync', () => {
  it('starts with a link to approve and keeps the device code in a sealed HttpOnly cookie', async () => {
    const epic = fakeEpic();
    const res = await epic.handlers.POST(post('start'));
    expect(res.status).toBe(200);
    expect((await res.json()) as SyncStart).toMatchObject({
      url: 'https://www.epicgames.com/activate?userCode=ABCD1234',
      code: 'ABCD1234',
      intervalMs: 5000,
    });
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^yr_epic=v1\./);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/sync');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toContain('device-code-secret');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('waits for approval, then signs in, ends the first session and lists the sessions Epic has you in', async () => {
    const epic = fakeEpic({
      pendingPolls: 1,
      teams: { [`${SLENDER.eventId}:${SLENDER.windowId}`]: [MATE, ME], 'bad-key': [ME] },
    });
    const start = await epic.handlers.POST(post('start'));
    const pending = await epic.handlers.POST(post('poll', cookieOf(start), undefined, '&region=BR'));
    expect(await pending.json()).toEqual({ status: 'pending', intervalMs: 5000 });
    const ready = await epic.handlers.POST(post('poll', cookieOf(start), undefined, '&region=BR'));
    const body = (await ready.json()) as SyncPoll;
    expect(body).toEqual({
      status: 'ready',
      accountId: ME,
      displayName: 'You',
      played: [{ ...SLENDER, team: [ME, MATE] }],
      epic: { playerKeys: ['accountId', 'tokens', 'teams'], teams: 2, tokens: 0 },
    });
    expect(epic.killed).toEqual(['switch-token']);
    expect(ready.headers.get('set-cookie')).not.toContain('your-token');
    expect(epic.calls).toContain('schedule yours BR');
  });

  it('reads your row with your team, as a lite entry, and ends the session when asked', async () => {
    const epic = fakeEpic({ teams: { [`${SLENDER.eventId}:${SLENDER.windowId}`]: [ME, MATE] } });
    const { cookie, body } = await signIn(epic);
    if (body.status !== 'ready') throw new Error('not ready');
    const res = await epic.handlers.POST(post('rows', cookie, { sessions: body.played }));
    const rows = (await res.json()) as SyncRows;
    expect(rows.remaining).toEqual([]);
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ ...SLENDER, status: 'found', board: { id: SLENDER.windowId } });
    expect(rows.results[0]!.entry).toMatchObject({ rank: 5, points: 584, sessions: [] });
    expect(rows.results[0]!.entry!.gamePoints!.reduce((a, b) => a + b, 0)).toBe(584);
    expect(rows.results[0]!.entry!.members.every((m) => m.name === undefined)).toBe(true);
    expect(rows.results[0]!.trace).toEqual([expect.stringMatching(/: 200, 1 row \(rank 5\)$/)]);

    const done = await epic.handlers.DELETE(new Request('https://app.test/api/sync', { headers: { cookie } }));
    expect(done.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(epic.killed).toContain('your-token');
  });

  const ranked = [8, 7, 6].map((n) => ({
    eventId: 'epicgames_S42_RankedCupSolo_NAC',
    windowId: `S42_RankedCupSolo_Event${n}_NAC`,
  }));

  it("settles a Ranked Cup you didn't play with one call on its main board", async () => {
    const epic = fakeEpic({ emptyOnMiss: true });
    const { cookie } = await signIn(epic);
    const rows = (await (await epic.handlers.POST(post('rows', cookie, { sessions: ranked }))).json()) as SyncRows;
    expect(rows.results.map((r) => r.status)).toEqual(['not_found', 'not_found', 'not_found']);
    expect(rows.remaining).toEqual([]);
    expect(epic.calls.filter((c) => c.startsWith('row'))).toEqual(ranked.map((s) => `row ${s.windowId}`));
    expect(rows.results[0]!.trace).toEqual(['Overall: 200, 0 rows']);
  });

  it("tries the tiers top first when the main board refuses, and hands back what didn't fit", async () => {
    const epic = fakeEpic();
    const { cookie } = await signIn(epic);
    const rows = (await (await epic.handlers.POST(post('rows', cookie, { sessions: ranked }))).json()) as SyncRows;
    // The main board and eight tiers: the second session runs out of the request's sixteen calls.
    expect(rows.results.map((r) => r.status)).toEqual(['not_found']);
    expect(rows.remaining.map((s) => s.windowId)).toEqual([
      'S42_RankedCupSolo_Event7_NAC',
      'S42_RankedCupSolo_Event6_NAC',
    ]);
    expect(epic.calls.filter((c) => c.startsWith('row')).slice(0, 2)).toEqual([
      'row S42_RankedCupSolo_Event8_NAC',
      expect.stringMatching(/^row S42_RankedCupSolo_Event8_NAC_\d_unreal$/),
    ]);
    // Each board's answer is kept for the sync's details.
    expect(rows.results[0]!.trace).toHaveLength(9);
    expect(rows.results[0]!.trace![1]).toMatch(/^Unreal: 400 com\.epicgames\.api\.malformed_data/);
  });

  it('refuses rows without a signed-in cookie, or a tampered one', async () => {
    const epic = fakeEpic();
    const none = await epic.handlers.POST(post('rows', undefined, { sessions: [SLENDER] }));
    expect(none.status).toBe(409);
    const { cookie } = await signIn(epic);
    const forged = await epic.handlers.POST(post('rows', `${cookie}x`, { sessions: [SLENDER] }));
    expect(forged.status).toBe(409);
    const bad = await epic.handlers.POST(post('rows', cookie, { sessions: [] }));
    expect(bad.status).toBe(400);
  });

  it("probes Epic's history for one session, reporting only its outline and shortened IDs", async () => {
    const forbidden = fakeEpic({
      history: {
        status: 403,
        body: { errorCode: 'errors.com.epicgames.common.forbidden', errorMessage: `No access for ${ME}` },
      },
    });
    const { cookie } = await signIn(forbidden);
    const res = await forbidden.handlers.POST(post('probe', cookie, SLENDER));
    const { history } = (await res.json()) as SyncProbe;
    expect(history).toBe(`403 errors.com.epicgames.common.forbidden: No access for ${ME.slice(0, 6)}…`);

    const ok = fakeEpic({
      history: { status: 200, body: [{ sessionId: 'secret-ish', rank: 7, sessions: [{ x: 1 }] }] },
    });
    const signed = await signIn(ok);
    const outline = ((await (await ok.handlers.POST(post('probe', signed.cookie, SLENDER))).json()) as SyncProbe)
      .history;
    expect(outline).toBe('200 [1 × {sessionId: string, rank: 7, sessions: [1 × {x: 1}]}]');
    expect(outline).not.toContain('secret-ish');
  });

  it('ends an unfinished sync when a new one starts', async () => {
    const epic = fakeEpic();
    const { cookie } = await signIn(epic);
    await epic.handlers.POST(post('start', cookie));
    expect(epic.killed).toEqual(['switch-token', 'your-token']);
  });
});

describe('playedSessions', () => {
  it('reads "<event>:<window>" keys with your team, and skips anything else', () => {
    const raw = {
      player: {
        teams: {
          'e1:w1': [ME, 'not-an-id'],
          'e2:w2': 'junk',
          'only-one-part': [ME],
          'a:b:c': [ME],
        },
      },
    };
    expect(playedSessions(raw, ME)).toEqual([
      { eventId: 'e1', windowId: 'w1', team: [ME] },
      { eventId: 'e2', windowId: 'w2', team: [ME] },
    ]);
    expect(playedSessions(JSON.parse(fixture('events-download-NAC.json')), ME)).toEqual([]);
  });
});
