import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CUMULATIVE_PAGES, makeLeaderboardHandler } from '../api/leaderboard';
import { makePlayerHandler } from '../api/player';
import { makeWindowHandler } from '../api/window';
import { EpicTokenManager, type FetchLike } from '../lib/auth/epicToken';
import { clearNameCache } from '../lib/epic/accounts';
import { EpicClient } from '../lib/epic/client';
import { clearScheduleCache } from '../lib/epic/schedule';
import type { LeaderboardPage, PlayerLookup, WindowDetail } from '../lib/types';

const fixture = (capture: string, f: string) => readFileSync(join(__dirname, 'fixtures/epic', capture, f), 'utf8');

type Board = (page: number) => unknown;

/**
 * Serves a capture's schedules; boards by "<group>/<instance>" (a fixture file or a
 * generator); bulk names as "Name-<id prefix>"; one known display name.
 */
function fakeEpic(capture: string, boards: Record<string, string | Board>) {
  const calls: string[] = [];
  const f: FetchLike = async (url) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    if (path === '/account/api/oauth/token')
      return Response.json({ access_token: 't', expires_in: 7200, account_id: 'svc' });
    if (path.startsWith('/api/v1/events/Fortnite/download/')) {
      const region = u.searchParams.get('region');
      calls.push(`schedule ${region}`);
      // The second capture only downloaded NAC, which also lists the NAW events.
      const file = existsSync(join(__dirname, 'fixtures/epic', capture, `events-download-${region}.json`))
        ? `events-download-${region}.json`
        : 'events-download-NAC.json';
      return new Response(fixture(capture, file));
    }
    if (path.startsWith('/api/v1/leaderboards/Fortnite/')) {
      const [group, instance] = path.split('/').slice(5, 7) as [string, string];
      const page = Number(u.searchParams.get('page'));
      calls.push(`board ${instance} p${page}`);
      const b = boards[`${group}/${instance}`];
      if (!b) return Response.json({ errorCode: 'com.epicgames.events.event_window_not_found' }, { status: 404 });
      return typeof b === 'string' ? new Response(fixture(capture, b)) : Response.json(b(page));
    }
    if (path === '/account/api/public/account') {
      const ids = u.searchParams.getAll('accountId');
      calls.push(`names ${ids.length}`);
      return Response.json(ids.map((id) => ({ id, displayName: `Name-${id.slice(-4)}` })));
    }
    if (path.startsWith('/account/api/public/account/displayName/')) {
      calls.push('lookup');
      const name = path.split('/').pop();
      if (name === 'Known Player') return Response.json({ id: 'a'.repeat(32), displayName: 'Known Player' });
      return Response.json({ errorCode: 'errors.com.epicgames.account.account_not_found' }, { status: 404 });
    }
    return new Response('{}', { status: 404 });
  };
  const client = new EpicClient({
    tokens: new EpicTokenManager({
      fetch: f,
      client: { id: 'c', secret: 's' },
      device: { accountId: 'svc', deviceId: 'd', secret: 's' },
    }),
    fetch: f,
    minGapMs: 0,
  });
  return { client, calls };
}

const at = (iso: string) => () => Date.parse(iso);
const req = (q: string) => new Request(`https://app.test/api/x?${q}`);
const cdnMaxAge = (res: Response) => /max-age=(\d+)/.exec(res.headers.get('vercel-cdn-cache-control') ?? '')?.[1];

beforeEach(() => {
  clearScheduleCache();
  clearNameCache();
});

describe('GET /api/leaderboard', () => {
  const FINAL = 'event=epicgames_S42_SlenderManCup_ZB_BR&window=S42_SlenderManCup_ZB_BR';
  const finalBoards = { 'epicgames_S42_SlenderManCup_ZB_BR/S42_SlenderManCup_ZB_BR': 'leaderboard-final-p0.json' };

  it('serves a final board with names, cached a day on the CDN and never in the browser', async () => {
    const { client, calls } = fakeEpic('first', finalBoards);
    const handler = makeLeaderboardHandler({
      client: () => client,
      accountId: () => 'svc',
      now: at('2026-10-21T03:00:00Z'),
    });
    const res = await handler(req(FINAL));
    expect(res.status).toBe(200);
    expect(cdnMaxAge(res)).toBe('86400');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as LeaderboardPage;
    expect(body).toMatchObject({ board: 'S42_SlenderManCup_ZB_BR', page: 0, totalPages: expect.any(Number) });
    expect(body.entries).toHaveLength(100);
    expect(body.entries[0]!.members.every((m) => m.name?.startsWith('Name-'))).toBe(true);
    expect(body.entries[0]!.sessions.length).toBeGreaterThan(0);
    expect(calls).toEqual(['schedule BR', 'board S42_SlenderManCup_ZB_BR p0', 'names 100', 'names 100']);

    calls.length = 0;
    await handler(req(FINAL));
    expect(calls).toEqual(['board S42_SlenderManCup_ZB_BR p0']);
  });

  it('skips names and match details in lite mode', async () => {
    const { client, calls } = fakeEpic('first', finalBoards);
    const res = await makeLeaderboardHandler({
      client: () => client,
      accountId: () => 'svc',
      now: at('2026-10-21T03:00:00Z'),
    })(req(`${FINAL}&lite=1`));
    const body = (await res.json()) as LeaderboardPage;
    expect(body.entries[0]!.members[0]!.name).toBeUndefined();
    expect(body.entries[0]!.sessions).toEqual([]);
    expect(body.entries[0]!.gamePoints!.length).toBe(body.entries[0]!.matches);
    expect(calls.some((c) => c.startsWith('names'))).toBe(false);
  });

  it('defaults a live Ranked Cup window to its top tier board, cached 30 s', async () => {
    const window = 'S42_RankedCupSoloReload_Event8_NAW';
    const { client } = fakeEpic('second', {
      [`epicgames_S42_RankedCupSoloReload_NAW/${window}_2_unreal`]: 'leaderboard-live-board-2_unreal.json',
    });
    const res = await makeLeaderboardHandler({
      client: () => client,
      accountId: () => 'svc',
      now: at('2026-10-21T02:00:00Z'),
    })(req(`event=epicgames_S42_RankedCupSoloReload_NAW&window=${window}`));
    expect(res.status).toBe(200);
    expect(cdnMaxAge(res)).toBe('30');
    const body = (await res.json()) as LeaderboardPage;
    expect(body.board).toBe(`${window}_2_unreal`);
    expect(body.entries[0]!.points).toBeGreaterThan(0);
  });

  it('computes cumulative standings from the event sessions', async () => {
    const ev = 'epicgames_S42_FNCSSolo_Final_NAC';
    const team = (id: string, points: number) => ({
      teamAccountIds: [id.repeat(32)],
      rank: 1,
      pointsEarned: points,
      sessionHistory: [
        { endTime: '2026-10-11T20:00:00Z', trackedStats: { PLACEMENT_STAT_INDEX: 1, TEAM_ELIMS_STAT_INDEX: 3 } },
      ],
    });
    const { client, calls } = fakeEpic('first', {
      [`${ev}/S42_FNCSSolo_Final_Day1_NAC`]: () => ({ totalPages: 1, entries: [team('a', 50), team('b', 40)] }),
      // Day 2 has more pages than are summed; each team appears on one page only.
      [`${ev}/S42_FNCSSolo_Final_Day2_NAC`]: (page) => ({
        totalPages: 5,
        entries: page === 0 ? [team('b', 30), team('c', 20)] : [],
      }),
    });
    const res = await makeLeaderboardHandler({
      client: () => client,
      accountId: () => 'svc',
      now: at('2026-11-01T00:00:00Z'),
    })(req(`event=${ev}&window=S42_FNCSSolo_Final_Day2_NAC&board=cumulative`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardPage;
    expect(body.entries.map((e) => [e.members[0]!.id[0], e.points])).toEqual([
      ['b', 70],
      ['a', 50],
      ['c', 20],
    ]);
    expect(body.approximate).toBe(true);
    expect(calls.filter((c) => c.startsWith('board'))).toEqual([
      'board S42_FNCSSolo_Final_Day1_NAC p0',
      ...Array.from({ length: CUMULATIVE_PAGES }, (_, p) => `board S42_FNCSSolo_Final_Day2_NAC p${p}`),
    ]);
  });

  it('rejects bad input and unknown sessions', async () => {
    const { client } = fakeEpic('first', finalBoards);
    const handler = makeLeaderboardHandler({ client: () => client, accountId: () => 'svc', now: Date.now });
    const cases: [string, number][] = [
      ['window=x', 400],
      [`${FINAL}&page=100`, 400],
      [`${FINAL}&page=-1`, 400],
      [`${FINAL}&board=../../x`, 400],
      [`${FINAL}&board=SomeOtherBoard`, 400],
      [`${FINAL}&board=cumulative`, 400],
      ['event=epicgames_S42_SlenderManCup_ZB_BR&window=Nope_BR', 404],
    ];
    for (const [q, status] of cases) {
      const res = await handler(req(q));
      expect([q, res.status]).toEqual([q, status]);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('GET /api/window', () => {
  it('describes a Ranked Cup window: unscored main board plus scored tiers', async () => {
    const { client } = fakeEpic('second', {});
    const res = await makeWindowHandler({ client: () => client, accountId: () => 'svc', now: Date.now })(
      req('event=epicgames_S42_RankedCupSoloReload_NAW&window=S42_RankedCupSoloReload_Event8_NAW'),
    );
    expect(cdnMaxAge(res)).toBe('3600');
    const body = (await res.json()) as WindowDetail;
    expect(body.boards).toHaveLength(9);
    expect(body.defaultBoard).toMatch(/_unreal$/);
    expect(body.boards.find((b) => b.label === 'Bronze')?.scoring?.placement[0]?.place).toBe(1);
  });
});

describe('GET /api/player', () => {
  const handler = (client: EpicClient) => makePlayerHandler({ client: () => client, now: Date.now });

  it('finds an account by display name', async () => {
    const { client } = fakeEpic('first', {});
    const res = await handler(client)(req('name=Known%20Player'));
    expect((await res.json()) as PlayerLookup).toEqual({ id: 'a'.repeat(32), displayName: 'Known Player' });
    expect(cdnMaxAge(res)).toBe('3600');
  });

  it('says plainly when no account has that name', async () => {
    const { client } = fakeEpic('first', {});
    const res = await handler(client)(req('name=Nobody'));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string; message: string } }).error).toEqual({
      code: 'player_not_found',
      message: 'No Epic account is called "Nobody".',
    });
  });

  it('refreshes names for a list of IDs', async () => {
    const { client } = fakeEpic('first', {});
    const ids = ['b'.repeat(32), 'c'.repeat(32)];
    const res = await handler(client)(req(`ids=${ids.join(',')}`));
    expect((await res.json()) as PlayerLookup[]).toEqual(
      ids.map((id) => ({ id, displayName: `Name-${id.slice(-4)}` })),
    );
  });

  it('validates input', async () => {
    const { client } = fakeEpic('first', {});
    for (const q of [
      '',
      'ids=nothex',
      `ids=${Array(101)
        .fill('a'.repeat(32))
        .map((a, i) => a.slice(0, 30) + String(i).padStart(2, '0'))
        .join(',')}`,
      'name=',
    ]) {
      expect((await handler(client)(req(q))).status, q).toBe(400);
    }
  });
});
