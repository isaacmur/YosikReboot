// SYNTHETIC test double. These bodies are shaped like community libraries say
// Epic's responses look, only so the probe's plumbing (routing, spacing, saving,
// scrubbing, analysis) can be tested offline. They are NOT fixtures and make no
// claim about Epic's real format — real captures go in test/fixtures/epic/.

import type { FetchLike } from '../../lib/auth/epicToken';

export const ACCESS_TOKEN = 'synthetic-access-token-0123456789';
export const REFRESH_TOKEN = 'synthetic-refresh-token-0123456789';
export const SERVICE_ACCOUNT = 'svc00000000000000000000000000001';

export interface FakeCall {
  method: string;
  url: string;
  auth?: string;
  body?: string;
}

export interface FakeEpicOptions {
  now: Date;
  /** Status to return from the token endpoint. */
  tokenStatus?: number;
  /** Team size on the final window's board. */
  teamSize?: number;
  /** Teams on each leaderboard page. */
  pageSize?: number;
  totalPages?: number;
  /** Whether teamAccountIds= actually filters. */
  filterWorks?: boolean;
  /** Return 429 after this many events calls. */
  rateLimitAfter?: number;
}

const iso = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000).toISOString();

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function fakeEpic(opts: FakeEpicOptions): { fetch: FetchLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const { now } = opts;
  const teamSize = opts.teamSize ?? 2;
  const pageSize = opts.pageSize ?? 60;
  const totalPages = opts.totalPages ?? 5;
  let eventsCalls = 0;

  const team = (page: number, i: number) =>
    Array.from({ length: teamSize }, (_, m) => `p${page}t${String(i).padStart(3, '0')}m${m}`.padEnd(32, '0'));

  const events = (region: string) => ({
    events: [
      {
        eventId: `epicgames_S99_TestCup_${region}`,
        regions: [region],
        displayDataId: 'test_cup',
        eventWindows: [
          { eventWindowId: `S99_TestCup_Final_${region}`, eventTemplateId: 'tpl_duos', beginTime: iso(now, -300), endTime: iso(now, -120), payoutDelay: 30, round: 0 },
          { eventWindowId: `S99_TestCup_Live_${region}`, eventTemplateId: 'tpl_solo', beginTime: iso(now, -30), endTime: iso(now, 60), payoutDelay: 30, round: 0 },
          { eventWindowId: `S99_TestCup_Soon_${region}`, eventTemplateId: 'tpl_solo', beginTime: iso(now, 600), endTime: iso(now, 780), payoutDelay: 30, round: 1 },
        ],
      },
    ],
    templates: [
      { eventTemplateId: 'tpl_duos', playlistId: 'Playlist_Test_Duos', scoringRules: [] },
      { eventTemplateId: 'tpl_solo', playlistId: 'Playlist_Test_Solo', scoringRules: [] },
    ],
  });

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({ method, url: input, auth: headers.get('authorization') ?? undefined, body: init?.body as string | undefined });
    const path = url.pathname;
    const authed = headers.get('authorization') === `bearer ${ACCESS_TOKEN}`;

    if (path === '/account/api/oauth/token') {
      if (opts.tokenStatus && opts.tokenStatus !== 200) {
        return json({ errorCode: 'errors.com.epicgames.account.invalid_account_credentials', errorMessage: 'nope' }, opts.tokenStatus);
      }
      return json({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 7200,
        expires_at: iso(now, 120),
        token_type: 'bearer',
        account_id: SERVICE_ACCOUNT,
        client_id: 'client123',
        country: 'US',
        displayName: 'YosikService',
      });
    }
    if (path.startsWith('/content/api/pages/fortnite-game/tournamentinformation')) {
      return json({ tournament_info: { tournaments: [{ tournament_display_id: 'test_cup', title_line_1: 'TEST CUP' }] } });
    }
    if (!authed) {
      return json({ errorCode: 'errors.com.epicgames.common.authentication.authentication_failed', errorMessage: 'no auth' }, 401);
    }
    if (path.includes('/api/v1/events/Fortnite/download/') || path.includes('/api/v1/events/Fortnite/data/')) {
      eventsCalls += 1;
      if (opts.rateLimitAfter !== undefined && eventsCalls > opts.rateLimitAfter) {
        return json({ errorCode: 'errors.com.epicgames.common.throttled' }, 429, { 'retry-after': '30' });
      }
      const region = url.searchParams.get('region');
      if (!region) {
        const all = ['NAE', 'EU'].map((r) => events(r));
        return json({ events: all.flatMap((a) => a.events), templates: all[0]!.templates });
      }
      return json(events(region));
    }
    if (path.startsWith('/api/v1/leaderboards/Fortnite/')) {
      const [, , , , , eventId, windowId] = path.split('/');
      if (windowId?.includes('DoesNotExist')) {
        return json({ errorCode: 'errors.com.epicgames.events.no_leaderboard', errorMessage: 'not found' }, 404);
      }
      const page = Number(url.searchParams.get('page') ?? 0);
      const wanted = url.searchParams.get('teamAccountIds')?.split(',').filter(Boolean) ?? [];
      let entries = Array.from({ length: pageSize }, (_, i) => ({
        teamAccountIds: team(page, i),
        rank: page * pageSize + i + 1,
        pointsEarned: 100 - i,
        sessionHistory: [{ sessionId: 's1', endTime: iso(now, -150), trackedStats: { PLACEMENT_STAT_INDEX: 3, TEAM_ELIMS_STAT_INDEX: 4 } }],
      }));
      if (wanted.length && opts.filterWorks !== false) {
        entries = [{ teamAccountIds: wanted, rank: 30, pointsEarned: 70, sessionHistory: [] }];
      }
      return json({ eventId, eventWindowId: windowId, page, totalPages, entries });
    }
    if (path.includes('/history')) return json([{ teamAccountIds: [SERVICE_ACCOUNT], rank: 1 }]);
    if (path === '/account/api/public/account') {
      const ids = url.searchParams.getAll('accountId');
      if (ids.length > 100) return json({ errorCode: 'errors.com.epicgames.account.too_many_accounts' }, 400);
      return json(ids.map((id) => ({ id, displayName: `name-${id.slice(0, 6)}`, externalAuths: { psn: { externalDisplayName: 'psn-name' } } })));
    }
    if (path.startsWith('/account/api/public/account/displayName/')) {
      return json({ id: SERVICE_ACCOUNT, displayName: decodeURIComponent(path.split('/').pop()!), email: 'owner@example.com', lastName: 'Owner' });
    }
    if (path.startsWith('/api/v1/players/Fortnite/tokens')) {
      return json({ accounts: [{ accountId: SERVICE_ACCOUNT, tokens: ['ARENA_S99_Division1'] }] });
    }
    return json({ errorCode: 'errors.com.epicgames.common.not_found' }, 404);
  };

  return { fetch: fetchImpl, calls };
}
