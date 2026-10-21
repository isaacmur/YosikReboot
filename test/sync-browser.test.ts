// The browser half of Sync with Epic (D30), with /api faked: results land like
// board searches, you become "me", and the Epic session ends however it goes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, EventInfo, EventsResponse, SyncPoll, SyncRows } from '../lib/types';
import { getFollows } from '../src/follows';
import { allScans, didNotPlay, isWindowChecked } from '../src/scan';
import { syncWithEpic } from '../src/sync';

const ME = 'a'.repeat(32);
const ended = (id: string, day: number) => ({
  id,
  label: id,
  round: 1,
  stage: 'open' as const,
  begin: `2026-10-0${day}T18:00:00Z`,
  end: `2026-10-0${day}T21:00:00Z`,
  isTBD: false,
  payoutDelayMin: 10,
  requirements: [],
});
const event = (id: string, teamSize: 1 | 2, windows: string[]) =>
  ({ id, name: `Cup ${id}`, teamSize, windows: windows.map((w, i) => ended(w, i + 1)) }) as unknown as EventInfo;
const EVENTS: EventsResponse = {
  region: 'EU',
  fetchedAt: '2026-10-21T00:00:00Z',
  events: [event('solo_EU', 1, ['s1_EU', 's2_EU']), event('duo_EU', 2, ['d1_EU'])],
};
const row = (rank: number): Entry => ({
  rank,
  teamKey: ME,
  members: [{ id: ME }],
  points: 300,
  matches: 5,
  victories: 1,
  elims: 9,
  avgPlace: 12,
  sessions: [],
  gamePoints: [60, 60, 60, 60, 60],
});

function fakeApi(
  played: SyncPoll & { status: 'ready' },
  rows: (body: { sessions: { windowId: string }[] }) => Response,
) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'https://app.test');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u.pathname}${u.searchParams.get('step') ? ` ${u.searchParams.get('step')}` : ''}`);
    if (u.pathname === '/api/events') return Response.json(EVENTS);
    if (method === 'DELETE') return Response.json({ ok: true });
    switch (u.searchParams.get('step')) {
      case 'start':
        return Response.json({
          url: 'https://epic.test/activate',
          code: 'C0DE',
          expiresAt: '2999-01-01T00:00:00Z',
          intervalMs: 1,
        });
      case 'poll':
        return Response.json(played);
      case 'rows':
        return rows(JSON.parse(String(init?.body)));
    }
    return new Response('{}', { status: 404 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('syncWithEpic', () => {
  it('keeps each result, marks the sessions you skipped, makes you "me", and signs out of Epic', async () => {
    const calls = fakeApi(
      {
        status: 'ready',
        accountId: ME,
        displayName: 'You',
        played: [{ eventId: 'solo_EU', windowId: 's2_EU', team: [ME] }],
      },
      () =>
        Response.json({
          results: [
            {
              eventId: 'solo_EU',
              windowId: 's2_EU',
              status: 'found',
              board: { id: 's2_EU', label: 'Overall', payouts: [] },
              entry: row(42),
            },
          ],
          remaining: [],
        } satisfies SyncRows),
    );
    const steps: string[] = [];
    const summary = await syncWithEpic({
      region: 'EU',
      signal: new AbortController().signal,
      onProgress: (p) => steps.push(p.step),
    });
    expect(summary).toMatchObject({ accountId: ME, displayName: 'You', sessions: 1, found: 1, fromEpicList: true });
    expect(steps).toEqual(['starting', 'approve', 'reading', 'reading']);
    expect(allScans().find((x) => x.windowId === 's2_EU')).toMatchObject({
      title: 'Cup solo_EU · s2_EU',
      final: true,
      found: { [ME]: { rank: 42, points: 300 } },
    });
    // Epic listed what you played, so the region's other sessions are done too.
    expect(['s1_EU', 's2_EU'].every((w) => isWindowChecked('solo_EU', w, ME))).toBe(true);
    expect(didNotPlay('solo_EU', 's1_EU', ME)).toBe(true);
    expect(didNotPlay('solo_EU', 's2_EU', ME)).toBe(false);
    expect(isWindowChecked('duo_EU', 'd1_EU', ME)).toBe(true);
    expect(getFollows().find((f) => f.id === ME)).toMatchObject({ name: 'You', isMe: true });
    expect(calls[calls.length - 1]).toBe('DELETE /api/sync');
  });

  it('signs out of Epic when a step fails', async () => {
    const calls = fakeApi({ status: 'ready', accountId: 'c'.repeat(32), displayName: 'You', played: null }, () =>
      Response.json({ error: { code: 'epic_upstream', message: 'Epic responded 502.' } }, { status: 502 }),
    );
    await expect(
      syncWithEpic({ region: 'EU', signal: new AbortController().signal, onProgress: () => {} }),
    ).rejects.toThrow('Epic responded 502.');
    expect(calls[calls.length - 1]).toBe('DELETE /api/sync');
  });

  it("with no list from Epic, tries your region's latest sessions and only rules out solo ones", async () => {
    const OTHER = 'b'.repeat(32);
    fakeApi({ status: 'ready', accountId: OTHER, displayName: null, played: null }, (body) =>
      Response.json({
        results: body.sessions.map((s) => ({
          eventId: s.windowId.startsWith('d') ? 'duo_EU' : 'solo_EU',
          windowId: s.windowId,
          status: 'not_found',
        })),
        remaining: [],
      }),
    );
    const summary = await syncWithEpic({ region: 'EU', signal: new AbortController().signal, onProgress: () => {} });
    expect(summary).toMatchObject({ sessions: 3, found: 0, fromEpicList: false });
    expect(isWindowChecked('solo_EU', 's1_EU', OTHER)).toBe(true);
    // A miss in a team mode might be a different team, so it stays for a manual check.
    expect(isWindowChecked('duo_EU', 'd1_EU', OTHER)).toBe(false);
  });
});
