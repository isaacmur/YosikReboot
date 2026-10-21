// Sync with Epic (D30): sealed cookies, the device code sign-in, your history
// and your own rows, and the session always ending at Epic.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSyncHandlers } from '../api/sync';
import { EpicTokenManager, type FetchLike } from '../lib/auth/epicToken';
import { seal, unseal } from '../lib/auth/seal';
import { EpicClient } from '../lib/epic/client';
import { historyResults, pastHistoryResults } from '../lib/epic/player';
import { clearScheduleCache } from '../lib/epic/schedule';
import type { SyncHistory, SyncPoll, SyncRows, SyncStart } from '../lib/types';

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
const BOARD = JSON.parse(fixture('leaderboard-final-p0.json')) as {
  entries: ({ teamAccountIds: string[] } & Record<string, unknown>)[];
};
const [ME, MATE] = BOARD.entries[4]!.teamAccountIds as [string, string];
const SLENDER = { eventId: 'epicgames_S42_SlenderManCup_ZB_BR', windowId: 'S42_SlenderManCup_ZB_BR' };
const RANKED = 'epicgames_S42_RankedCupSolo_NAC';
const NOW = Date.parse('2026-10-21T03:00:00Z');

/**
 * A score as Epic's per-player history lists it: a leaderboard entry (here, a real
 * one from the fixture board) with a `scoreKey` naming its board.
 */
const scoreOn = (eventId: string, windowId: string, entry: Record<string, unknown> = BOARD.entries[4]!) => ({
  scoreKey: { gameId: 'Fortnite', eventId, eventWindowId: windowId, _scoreId: null },
  liveSessionId: null,
  ...entry,
});

/** A fake Epic for the whole sync: device code sign-in, exchange, your schedule and your filtered rows. */
function fakeEpic(
  o: {
    pendingPolls?: number;
    teams?: Record<string, string[]>;
    /** Epic's per-player history for an event; `team` is the teamAccountIds asked with, null if none. */
    history?: (eventId: string, team: string | null) => { status: number; body: unknown };
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
    const history = /^\/api\/v1\/events\/Fortnite\/([^/]+)\/history\/([^/]+)$/.exec(path);
    if (history) {
      const team = u.searchParams.get('teamAccountIds');
      calls.push(`history ${history[1]}${team === null ? '' : ` team=${team}`}`);
      expect(history[2]).toBe(ME);
      expect(auth).toBe('bearer your-token');
      const answer = o.history?.(history[1]!, team) ?? { status: 200, body: [] };
      return Response.json(answer.body, { status: answer.status });
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

  it('waits for approval, then signs in, ends the first session and outlines your schedule download', async () => {
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
      epic: { playerKeys: ['accountId', 'tokens', 'teams'], teams: 2, tokens: 0, scores: 0 },
    });
    expect(epic.killed).toEqual(['switch-token']);
    expect(ready.headers.get('set-cookie')).not.toContain('your-token');
    expect(epic.calls).toContain('schedule yours BR');
  });

  it('reads your row with your team, as a lite entry, and ends the session when asked', async () => {
    const epic = fakeEpic();
    const { cookie } = await signIn(epic);
    const res = await epic.handlers.POST(post('rows', cookie, { sessions: [{ ...SLENDER, team: [MATE] }] }));
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

  it("reads Epic's history for each event: your row in every final session, on its board", async () => {
    const epic = fakeEpic({
      history: (eventId) => ({
        status: 200,
        body:
          eventId === SLENDER.eventId
            ? [scoreOn(SLENDER.eventId, SLENDER.windowId), scoreOn(SLENDER.eventId, 'no_such_board')]
            : [],
      }),
    });
    const { cookie } = await signIn(epic);
    const res = await epic.handlers.POST(post('history', cookie, { events: [SLENDER.eventId, RANKED] }));
    const body = (await res.json()) as SyncHistory;
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.remaining).toEqual([]);
    expect(body.events.map((h) => h.eventId)).toEqual([SLENDER.eventId, RANKED]);
    const [slender, ranked] = body.events as [SyncHistory['events'][0], SyncHistory['events'][0]];
    expect(slender).toMatchObject({ error: null, played: [SLENDER.windowId], toRead: [], unmatched: 1 });
    expect(slender.results).toHaveLength(1);
    expect(slender.results[0]).toMatchObject({ ...SLENDER, status: 'found', board: { id: SLENDER.windowId } });
    expect(slender.results[0]!.entry).toMatchObject({ rank: 5, points: 584, sessions: [] });
    expect(slender.results[0]!.entry!.members.map((m) => m.id)).toEqual([ME, MATE]);
    expect(ranked).toEqual({ eventId: RANKED, error: null, played: [], results: [], toRead: [], unmatched: 0 });
    // One call per event, without a team, and no board reads.
    expect(epic.calls.filter((c) => /^(history|row)/.test(c))).toEqual([
      `history ${SLENDER.eventId}`,
      `history ${RANKED}`,
    ]);
  });

  it('asks again naming just you when Epic wants a team, and reports a refusal in one line', async () => {
    const epic = fakeEpic({
      history: (eventId, team) =>
        eventId === RANKED
          ? {
              status: 403,
              body: {
                errorCode: 'errors.com.epicgames.common.forbidden',
                errorMessage: `Sorry your login does not posses the permissions 'Fortnite:profile:${ME}:commands READ'`,
              },
            }
          : team === null
            ? { status: 400, body: { errorCode: 'errors.com.epicgames.common.rejection.MissingQueryParamRejection' } }
            : { status: 200, body: [scoreOn(SLENDER.eventId, SLENDER.windowId)] },
    });
    const { cookie } = await signIn(epic);
    const res = await epic.handlers.POST(post('history', cookie, { events: [SLENDER.eventId, RANKED] }));
    const [slender, ranked] = ((await res.json()) as SyncHistory).events;
    expect(epic.calls.filter((c) => c.startsWith(`history ${SLENDER.eventId}`))).toEqual([
      `history ${SLENDER.eventId}`,
      `history ${SLENDER.eventId} team=${ME}`,
    ]);
    expect(slender!.results.map((r) => r.entry?.rank)).toEqual([5]);
    expect(ranked!.error).toBe(
      `403 errors.com.epicgames.common.forbidden: Sorry your login does not posses the permissions 'Fortnite:profile:${ME.slice(0, 6)}…:commands READ'`,
    );
  });

  it('hands back events past the budget, and checks the request', async () => {
    const epic = fakeEpic({
      history: () => ({
        status: 400,
        body: { errorCode: 'errors.com.epicgames.common.rejection.MissingQueryParamRejection' },
      }),
    });
    const { cookie } = await signIn(epic);
    const nac = (JSON.parse(fixture('events-download-NAC.json')) as { events: { eventId: string }[] }).events;
    const ids = nac.slice(0, 12).map((e) => e.eventId);
    const body = (await (await epic.handlers.POST(post('history', cookie, { events: ids }))).json()) as SyncHistory;
    // Two calls per event (without a team, then naming you): the request's sixteen run out before the ninth.
    expect(epic.calls.filter((c) => c.startsWith('history'))).toHaveLength(16);
    expect(body.remaining.length).toBeGreaterThanOrEqual(3);
    expect([...body.events.map((h) => h.eventId), ...body.remaining].sort()).toEqual([...ids].sort());

    const tooMany = await epic.handlers.POST(post('history', cookie, { events: [...ids, 'epicgames_X_NAC'] }));
    expect(tooMany.status).toBe(400);
    const none = await epic.handlers.POST(post('history', undefined, { events: [RANKED] }));
    expect(none.status).toBe(409);
  });

  it("still asks about an event Epic's schedule no longer lists, telling its boards apart by ID", async () => {
    const PAST = 'epicgames_S42_FNCSSoloQualifiers_NAC';
    const epic = fakeEpic({
      history: (eventId) => ({
        status: 200,
        body: eventId === PAST ? [scoreOn(PAST, 'S42_FNCSSoloQualifiers_Qual1Round1Day1_NAC')] : [],
      }),
    });
    const { cookie } = await signIn(epic);
    const res = await epic.handlers.POST(post('history', cookie, { events: [PAST] }));
    const [h] = ((await res.json()) as SyncHistory).events;
    expect(epic.calls).toContain(`history ${PAST}`);
    expect(h).toMatchObject({ error: null, played: ['S42_FNCSSoloQualifiers_Qual1Round1Day1_NAC'], toRead: [] });
    expect(h!.results[0]).toMatchObject({
      windowId: 'S42_FNCSSoloQualifiers_Qual1Round1Day1_NAC',
      board: { id: 'S42_FNCSSoloQualifiers_Qual1Round1Day1_NAC', label: 'Overall', payouts: [] },
      label: 'Qual 1 Round 1 Day 1',
      entry: { rank: 5, points: 584 },
    });
    expect(h!.results[0]!.endedAt).toMatch(/^20\d\d-/);
  });

  it('signs out when Epic ends the sign-in mid-history', async () => {
    const epic = fakeEpic({
      history: () => ({ status: 401, body: { errorCode: 'errors.com.epicgames.common.unauthorized' } }),
    });
    const { cookie } = await signIn(epic);
    const res = await epic.handlers.POST(post('history', cookie, { events: [RANKED] }));
    expect(res.status).toBe(409);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('ends an unfinished sync when a new one starts', async () => {
    const epic = fakeEpic();
    const { cookie } = await signIn(epic);
    await epic.handlers.POST(post('start', cookie));
    expect(epic.killed).toEqual(['switch-token', 'your-token']);
  });
});

describe('historyResults', () => {
  const raw = (region: string) => JSON.parse(fixture(`events-download-${region}.json`)) as unknown;
  const nac = raw('NAC');
  const tiers = (windowId: string) =>
    (
      (nac as { resolvedWindowLocations: Record<string, string[]> }).resolvedWindowLocations[
        `Fortnite:${RANKED}:${windowId}`
      ] ?? []
    )
      .map((k) => k.split(':')[2]!)
      .filter((id) => id !== windowId);

  it("takes a Ranked Cup's standing from its tier board, and sends sessions with only the main board to be read", () => {
    const [event8, event7] = ['S42_RankedCupSolo_Event8_NAC', 'S42_RankedCupSolo_Event7_NAC'];
    const gold = tiers(event8).find((id) => /gold$/i.test(id))!;
    expect(gold).toBeDefined();
    const solo = { ...BOARD.entries[0]!, teamAccountIds: [ME] };
    const out = historyResults(
      nac,
      RANKED,
      [
        // Event 8: the main board (no points) and the Gold tier, found through `_scoreId`.
        scoreOn(RANKED, event8, solo),
        { ...scoreOn(RANKED, event8, solo), scoreKey: { eventId: RANKED, _scoreId: `Fortnite:${RANKED}:${gold}` } },
        // Event 7: only the main board.
        scoreOn(RANKED, event7, { ...solo, teamAccountIds: [ME, 'not-an-id'] }),
      ],
      ME,
      NOW,
    );
    expect(out.played).toEqual([event8, event7]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ windowId: event8, board: { id: gold, label: 'Gold' } });
    expect(out.results[0]!.entry!.rank).toBe(1);
    expect(out.toRead).toEqual([{ eventId: RANKED, windowId: event7, team: [ME] }]);

    // A tier score without a standing goes to be read too.
    const unranked = historyResults(
      nac,
      RANKED,
      [{ ...scoreOn(RANKED, gold, solo), rank: 0, scoreKey: { eventId: RANKED, eventWindowId: gold } }],
      ME,
      NOW,
    );
    expect(unranked).toMatchObject({ played: [event8], results: [], toRead: [{ windowId: event8 }] });
    expect(out.unmatched).toBe(0);
  });

  it("lists sessions that aren't final yet as played, without a result", () => {
    const out = historyResults(raw('BR'), SLENDER.eventId, [scoreOn(SLENDER.eventId, SLENDER.windowId)], ME, 0);
    expect(out).toEqual({ played: [SLENDER.windowId], results: [], toRead: [], unmatched: 0 });
  });

  it('reads a Ranked Cup Epic no longer lists from its tier scores, never its pointless main board', () => {
    const PAST = 'epicgames_S41_RankedCupSolo_NAC';
    const [main8, main7] = ['S41_RankedCupSolo_Event8_NAC', 'S41_RankedCupSolo_Event7_NAC'];
    const solo = { ...BOARD.entries[0]!, teamAccountIds: [ME] };
    const out = pastHistoryResults(PAST, [
      scoreOn(PAST, main8, { ...solo, pointsEarned: 0, score: 1, rank: 4000 }),
      scoreOn(PAST, `${main8}_2_gold`, solo),
      scoreOn(PAST, main7, { ...solo, pointsEarned: 0, score: 1, rank: 12 }),
      scoreOn('another_event', main7, solo),
    ]);
    expect(out.played).toEqual([main8, main7]);
    expect(out.unmatched).toBe(1);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({
      windowId: main8,
      board: { id: `${main8}_2_gold`, label: 'Gold' },
      entry: { rank: 1 },
      label: 'Event 8',
    });
  });

  it('counts scores it can place nowhere, and skips junk', () => {
    const out = historyResults(raw('BR'), SLENDER.eventId, [null, 'x', { rank: 3 }, scoreOn('other', 'w')], ME, NOW);
    expect(out).toEqual({ played: [], results: [], toRead: [], unmatched: 4 });
  });
});
