// The browser half of Sync with Epic (D30), with /api faked: a session you're
// known to have played is checked first, results land like board searches, you
// become "me", and the Epic session ends however it goes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, EventInfo, EventsResponse, SyncPoll, SyncRowResult } from '../lib/types';
import { getFollows } from '../src/follows';
import { allScans, didNotPlay, isWindowChecked, recordResult } from '../src/scan';
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
const EVENTS: EventsResponse = {
  region: 'EU',
  fetchedAt: new Date().toISOString(),
  events: [
    event('solo_EU', 1, [
      ['s1_EU', 2],
      ['s2_EU', 5],
      ['old_EU', 40],
    ]),
    event('duo_EU', 2, [['d1_EU', 3]]),
  ],
};
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
const EPIC = { playerKeys: ['accountId', 'tokens', 'teams'], teams: 1, tokens: 3 };
type Ready = Extract<SyncPoll, { status: 'ready' }>;
const ready = (accountId: string, played: Ready['played'] = null): Ready => ({
  status: 'ready',
  accountId,
  displayName: 'You',
  played,
  epic: EPIC,
});

/** Fakes /api: `answer` gives each session's row result; records each rows request's sessions. */
function fakeApi(poll: SyncPoll, answer: (windowId: string) => Omit<SyncRowResult, 'eventId' | 'windowId'>) {
  const calls: string[] = [];
  const requests: string[][] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'https://app.test');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u.pathname}${u.searchParams.get('step') ? ` ${u.searchParams.get('step')}` : ''}`);
    if (u.pathname === '/api/events') return Response.json(EVENTS);
    if (method === 'DELETE') return Response.json({ ok: true });
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
      case 'probe':
        return Response.json({ history: '403 errors.com.epicgames.common.forbidden' });
      case 'rows': {
        const { sessions } = JSON.parse(String(init?.body)) as { sessions: { eventId: string; windowId: string }[] };
        requests.push(sessions.map((s) => s.windowId));
        return Response.json({ results: sessions.map((s) => ({ ...s, ...answer(s.windowId) })), remaining: [] });
      }
    }
    return new Response('{}', { status: 404 });
  });
  return { calls, requests };
}

const sync = () => syncWithEpic({ region: 'EU', signal: new AbortController().signal, onProgress: () => {} });
const known = (id: string, rank: number) =>
  recordResult({ eventId: 'solo_EU', windowId: 's2_EU', board: 's2_EU', boardLabel: 'Overall' }, id, row(id, rank));

afterEach(() => vi.unstubAllGlobals());

describe('syncWithEpic', () => {
  it('checks a session you played first, then reads your recent sessions and keeps what it finds', async () => {
    const A = 'a'.repeat(32);
    known(A, 42);
    const { calls, requests } = fakeApi(
      ready(A, [{ eventId: 'duo_EU', windowId: 'd1_EU', team: [A, 'f'.repeat(32)] }]),
      (w) =>
        w === 's2_EU'
          ? {
              status: 'found',
              board: { id: w, label: 'Overall', payouts: [] },
              entry: row(A, 42),
              trace: ['Overall: 200, 1 row (rank 42)'],
            }
          : w === 'd1_EU'
            ? { status: 'found', board: { id: w, label: 'Overall', payouts: [] }, entry: row(A, 7), trace: [] }
            : { status: 'not_found', trace: ['Overall: 200, 0 rows'] },
    );
    const summary = await sync();
    // The check on its own, then Epic's list, then the rest of the last three weeks (not the 40-day-old one).
    expect(requests).toEqual([['s2_EU'], ['d1_EU', 's1_EU']]);
    expect(summary).toMatchObject({ accountId: A, sessions: 3, found: 2, stoppedEarly: false });
    expect(summary.details.join('\n')).toContain("Epic's list for you (player.teams) had 1: Cup duo_EU · d1_EU");
    expect(summary.details.join('\n')).toContain(
      'Check on Cup solo_EU · s2_EU, where a board search found you at #42: found (#42)',
    );
    expect(allScans().find((x) => x.windowId === 'd1_EU')?.found[A]).toMatchObject({ rank: 7 });
    // The filter works and s1 is solo, so no row there means you didn't play it; nothing is assumed about the rest.
    expect(didNotPlay('solo_EU', 's1_EU', A)).toBe(true);
    expect(isWindowChecked('solo_EU', 'old_EU', A)).toBe(false);
    expect(getFollows().find((f) => f.id === A)).toMatchObject({ isMe: true });
    expect(calls[calls.length - 1]).toBe('DELETE /api/sync');
  });

  it("stops early when the filter misses a session you played, and asks Epic's history instead", async () => {
    const B = 'b'.repeat(32);
    known(B, 99);
    const { calls, requests } = fakeApi(ready(B), () => ({ status: 'not_found', trace: ['Overall: 200, 0 rows'] }));
    const summary = await sync();
    expect(requests).toEqual([['s2_EU']]);
    expect(calls).toContain('POST /api/sync probe');
    expect(summary).toMatchObject({ sessions: 1, found: 0, stoppedEarly: true });
    expect(summary.details.join('\n')).toContain(
      "Epic's history for Cup solo_EU · s2_EU: 403 errors.com.epicgames.common.forbidden",
    );
    expect(isWindowChecked('solo_EU', 's1_EU', B)).toBe(false);
    expect(calls[calls.length - 1]).toBe('DELETE /api/sync');
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
