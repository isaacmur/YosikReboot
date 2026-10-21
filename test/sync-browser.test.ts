// The browser half of Sync with Epic (D30), with /api faked: every event's
// history is read across regions, Ranked Cup tiers are read with your team,
// results land like board searches, a board search's result is checked against
// the history, you become "me", and the Epic session ends however it goes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Entry,
  EventInfo,
  EventsResponse,
  SyncEventHistory,
  SyncPoll,
  SyncRowResult,
  SyncSession,
} from '../lib/types';
import { logout } from '../src/api';
import { getFollows } from '../src/follows';
import { allScans, didNotPlay, isWindowChecked, scanBoard } from '../src/scan';
import { syncWithEpic } from '../src/sync';

const DAY = 86_400_000;
const ended = (id: string, daysAgo: number) => {
  const end = Date.now() - daysAgo * DAY;
  return {
    id,
    label: id,
    round: 1,
    stage: 'open' as const,
    begin: new Date(end - 3 * 3_600_000).toISOString(),
    end: new Date(end).toISOString(),
    isTBD: false,
    payoutDelayMin: 10,
    requirements: [],
  };
};
const event = (id: string, teamSize: 1 | 2, windows: [string, number][]) =>
  ({ id, name: `Cup ${id}`, teamSize, windows: windows.map(([w, d]) => ended(w, d)) }) as unknown as EventInfo;
const SOLO = event('solo_EU', 1, [
  ['s1_EU', 2],
  ['s2_EU', 5],
  ['old_EU', 40],
]);
const DUO = event('duo_EU', 2, [
  ['d1_EU', 3],
  ['d2_EU', 4],
]);
const RANKED = event('ranked_NAC', 1, [
  ['r1_NAC', 1],
  ['r2_NAC', 2],
]);
const UPCOMING = event('soon_NAC', 1, [['u1_NAC', -2]]);
const byRegion: Record<string, EventInfo[]> = { EU: [SOLO, DUO], NAC: [RANKED, UPCOMING, SOLO] };

const row = (id: string, rank: number): Entry => ({
  rank,
  teamKey: id,
  members: [{ id }],
  points: 300,
  matches: 5,
  victories: 1,
  elims: 9,
  avgPlace: 12,
  sessions: [],
  gamePoints: [60, 60, 60, 60, 60],
});
const ready = (accountId: string): SyncPoll => ({
  status: 'ready',
  accountId,
  displayName: 'You',
  epic: { playerKeys: ['accountId', 'tokens', 'teams'], teams: 1, tokens: 3, scores: 0 },
});
const found = (eventId: string, windowId: string, entry: Entry, label = 'Overall'): SyncRowResult => ({
  eventId,
  windowId,
  status: 'found',
  board: { id: label === 'Overall' ? windowId : `${windowId}_${label}`, label, payouts: [] },
  entry,
});
const history = (eventId: string, o: Partial<SyncEventHistory> = {}): SyncEventHistory => ({
  eventId,
  error: null,
  played: [...(o.results ?? []), ...(o.toRead ?? [])].map((x) => x.windowId),
  results: [],
  toRead: [],
  unmatched: 0,
  ...o,
});

/** Fakes /api: `answer` gives each event's history and `rows` each session's row; records what each step was sent. */
function fakeApi(
  poll: SyncPoll,
  answer: (eventId: string) => SyncEventHistory,
  rows: (s: SyncSession) => SyncRowResult = (s) => ({ ...s, status: 'not_found' }),
) {
  const calls: string[] = [];
  const historyRequests: string[][] = [];
  const rowRequests: SyncSession[][] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'https://app.test');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u.pathname}${u.searchParams.get('step') ? ` ${u.searchParams.get('step')}` : ''}`);
    if (u.pathname === '/api/events') {
      const region = u.searchParams.get('region')!;
      return Response.json({
        region,
        fetchedAt: new Date().toISOString(),
        events: byRegion[region] ?? [],
      } as EventsResponse);
    }
    if (u.pathname === '/api/leaderboard') {
      const id = u.searchParams.get('window') === 's2_EU' ? 'b'.repeat(32) : 'x'.repeat(32);
      return Response.json({ page: 0, totalPages: 1, entries: [row(id, 99)] });
    }
    if (method === 'DELETE') return Response.json({ ok: true });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    switch (u.searchParams.get('step')) {
      case 'start':
        return Response.json({
          url: 'https://epic.test/a',
          code: 'C0DE',
          expiresAt: '2999-01-01T00:00:00Z',
          intervalMs: 1,
        });
      case 'poll':
        return Response.json(poll);
      case 'history': {
        const events = body.events as string[];
        historyRequests.push(events);
        return Response.json({ events: events.map(answer), remaining: [] });
      }
      case 'rows': {
        const sessions = body.sessions as SyncSession[];
        rowRequests.push(sessions);
        return Response.json({ results: sessions.map(rows), remaining: [] });
      }
    }
    return new Response('{}', { status: 404 });
  });
  return { calls, historyRequests, rowRequests };
}

const sync = () => syncWithEpic({ region: 'EU', signal: new AbortController().signal, onProgress: () => {} });

afterEach(() => vi.unstubAllGlobals());

describe('syncWithEpic', () => {
  it("reads every finished event's history, in every region, and keeps your results", async () => {
    const A = 'a'.repeat(32);
    const { calls, historyRequests, rowRequests } = fakeApi(
      ready(A),
      (id) =>
        id === 'solo_EU'
          ? history(id, { results: [found(id, 's2_EU', row(A, 42))] })
          : id === 'duo_EU'
            ? history(id, { results: [found(id, 'd1_EU', row(A, 7))] })
            : history(id, { toRead: [{ eventId: id, windowId: 'r1_NAC', team: [A] }] }),
      (s) => found(s.eventId, s.windowId, row(A, 3), 'Gold'),
    );
    const summary = await sync();
    // One request, your region's events first; the upcoming one isn't asked about, and SOLO only once.
    expect(historyRequests).toEqual([['duo_EU', 'solo_EU', 'ranked_NAC']]);
    expect(rowRequests).toEqual([[{ eventId: 'ranked_NAC', windowId: 'r1_NAC', team: [A] }]]);
    expect(summary).toMatchObject({ accountId: A, events: 3, found: 3 });
    expect(allScans().find((x) => x.windowId === 'd1_EU')?.found[A]).toMatchObject({ rank: 7 });
    expect(allScans().find((x) => x.windowId === 'r1_NAC')).toMatchObject({ board: 'r1_NAC_Gold', boardLabel: 'Gold' });
    // The history lists every session you played, so the rest of each event's finished ones you didn't,
    // in solo and duos alike, since it has shown both: the season's oldest included.
    for (const [e, w] of [
      ['solo_EU', 's1_EU'],
      ['solo_EU', 'old_EU'],
      ['duo_EU', 'd2_EU'],
      ['ranked_NAC', 'r2_NAC'],
    ])
      expect(didNotPlay(e!, w!, A)).toBe(true);
    expect(didNotPlay('solo_EU', 's2_EU', A)).toBe(false);
    const details = summary.details.join('\n');
    expect(details).toContain('Cup solo_EU: s2_EU 42nd');
    expect(details).toContain('Cup ranked_NAC: r1_NAC (read from the board)');
    expect(details).toContain("Kept 3 results; 4 finished sessions you didn't play left off the list to check.");
    expect(getFollows().find((f) => f.id === A)).toMatchObject({ isMe: true });
    expect(calls[calls.length - 1]).toBe('DELETE /api/sync');

    // A second sync only asks about events with a finished session still unsettled: none.
    const again = fakeApi(ready(A), (id) => history(id));
    expect((await sync()).events).toBe(0);
    expect(again.historyRequests).toEqual([]);
  });

  it("checks a board search's result against the history, and trusts nothing it misses", async () => {
    const B = 'b'.repeat(32);
    fakeApi(ready(B), (id) => history(id));
    await scanBoard('solo_EU', 's2_EU', 's2_EU', [B], { final: true, boardLabel: 'Overall' });
    const { historyRequests } = fakeApi(ready(B), (id) =>
      id === 'duo_EU' ? history(id, { results: [found(id, 'd1_EU', row(B, 7))] }) : history(id),
    );
    const summary = await sync();
    expect(historyRequests).toEqual([['duo_EU', 'solo_EU', 'ranked_NAC']]);
    expect(summary.details.join('\n')).toContain(
      "Check on Cup solo_EU · s2_EU: a board search found you 99th; Epic's history doesn't list it.",
    );
    expect(isWindowChecked('duo_EU', 'd1_EU', B)).toBe(true);
    expect(didNotPlay('duo_EU', 'd2_EU', B)).toBe(false);
    expect(didNotPlay('solo_EU', 's1_EU', B)).toBe(false);
  });

  it('marks unplayed sessions only in team sizes the history has shown it lists', async () => {
    const C = 'c'.repeat(32);
    fakeApi(ready(C), (id) =>
      id === 'solo_EU' ? history(id, { results: [found(id, 's1_EU', row(C, 12))] }) : history(id),
    );
    await sync();
    expect(didNotPlay('solo_EU', 's2_EU', C)).toBe(true);
    expect(didNotPlay('ranked_NAC', 'r1_NAC', C)).toBe(true);
    expect(didNotPlay('duo_EU', 'd1_EU', C)).toBe(false);
  });

  it('stops asking once Epic forbids the history, and says so', async () => {
    const D = 'd'.repeat(32);
    const many = Array.from({ length: 14 }, (_, i) => event(`n${String(i).padStart(2, '0')}_NAC`, 1, [['w', 1]]));
    byRegion.NAC = [...byRegion.NAC!, ...many];
    try {
      const { historyRequests } = fakeApi(ready(D), (id) =>
        history(id, {
          error: '403 errors.com.epicgames.common.forbidden: Sorry your login does not posses the permissions',
        }),
      );
      await logout(); // Forgets the schedules read by earlier tests.
      const summary = await sync();
      expect(historyRequests).toHaveLength(1);
      expect(summary).toMatchObject({ events: 12, found: 0 });
      expect(summary.details.join('\n')).toContain(
        "Epic didn't return the history for 12 events, e.g. Cup duo_EU: 403 errors.com.epicgames.common.forbidden",
      );
      expect(didNotPlay('solo_EU', 's1_EU', D)).toBe(false);
    } finally {
      byRegion.NAC = byRegion.NAC!.slice(0, 3);
    }
  });

  it('signs out of Epic when a step fails', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(url, 'https://app.test').pathname}`);
      if (init?.method === 'DELETE') return Response.json({ ok: true });
      return Response.json({ error: { code: 'config', message: 'Missing environment variables' } }, { status: 500 });
    });
    await expect(sync()).rejects.toThrow('Missing environment variables');
    expect(calls).toEqual(['POST /api/sync', 'DELETE /api/sync']);
  });
});
