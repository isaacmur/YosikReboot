// Browser-side logic that doesn't need a DOM: follow list parsing/import and
// the board scanner (with fetch faked). localStorage is absent here, so the
// stores run in memory, which is also how they behave in a private window.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, LeaderboardPage, WindowDetail } from '../lib/types';
import { dedupeTeams } from '../src/entries';
import { addFollow, getFollows, importFollows, parseFollows, removeFollow, setMe } from '../src/follows';
import { allScans, cachedScan, isWindowChecked, scanBoard, scanWindow } from '../src/scan';

const id = (c: string) => c.repeat(32);

describe('follows', () => {
  afterEach(() => {
    for (const f of getFollows()) removeFollow(f.id);
  });

  it('parses exported lists, dropping junk, duplicates and extra "me" marks', () => {
    const parsed = parseFollows({
      version: 1,
      follows: [
        { id: id('a'), name: 'A', isMe: true },
        { id: id('a'), name: 'dup' },
        { id: 'not-an-id', name: 'X' },
        { id: id('b'), name: 'B', isMe: true },
        { id: id('c') },
      ],
    });
    expect(parsed.map((f) => [f.name, !!f.isMe])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    expect(() => parseFollows('nope')).toThrow();
  });

  it('adds, marks one follow as me, and merges imports without stealing "me"', () => {
    addFollow(id('a'), 'Alpha');
    addFollow(id('a'), 'Alpha again');
    setMe(id('a'));
    const added = importFollows(
      JSON.stringify({
        follows: [
          { id: id('a'), name: 'Alpha' },
          { id: id('b'), name: 'Beta', isMe: true },
        ],
      }),
    );
    expect(added).toBe(1);
    expect(getFollows().map((f) => [f.name, !!f.isMe])).toEqual([
      ['Alpha', true],
      ['Beta', false],
    ]);
    setMe(null);
    expect(getFollows().some((f) => f.isMe)).toBe(false);
  });
});

/** A board of `pages` pages; team N (0-based overall) has member `m<N>`, padded to 32 hex-ish chars. */
function fakeBoards(boards: Record<string, number>, calls: string[]) {
  const member = (n: number) => `m${n}`.padEnd(32, 'f');
  vi.stubGlobal('fetch', async (input: string) => {
    const u = new URL(input, 'https://app.test');
    if (u.pathname === '/api/window') {
      const detail: WindowDetail = {
        eventId: 'e',
        windowId: 'w',
        defaultBoard: 'w',
        boards: [
          { id: 'w', kind: 'main', label: 'Overall', computed: false, hasPoints: false, scoring: null, payouts: [] },
          ...Object.keys(boards).map((b) => ({
            id: b,
            kind: 'tier' as const,
            label: b,
            computed: false,
            hasPoints: true,
            scoring: null,
            payouts: [],
          })),
        ],
      };
      return Response.json(detail);
    }
    const board = u.searchParams.get('board')!;
    const page = Number(u.searchParams.get('page'));
    calls.push(`${board} p${page}`);
    const offset = Object.keys(boards).indexOf(board) * 1000;
    const body: LeaderboardPage = {
      eventId: 'e',
      windowId: 'w',
      board,
      page,
      totalPages: boards[board]!,
      fetchedAt: '',
      entries: Array.from({ length: 100 }, (_, i) => ({
        rank: page * 100 + i + 1,
        teamKey: member(offset + page * 100 + i),
        members: [{ id: member(offset + page * 100 + i) }],
        points: 1000 - i,
        matches: 5,
        victories: 0,
        elims: 3,
        avgPlace: 20,
        sessions: [],
      })),
    };
    return Response.json(body);
  });
  return member;
}

describe('scanBoard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stops at the page where everyone is found', async () => {
    const calls: string[] = [];
    const member = fakeBoards({ b1: 10 }, calls);
    const scan = await scanBoard('e', 'w', 'b1', [member(250)], { final: false, boardLabel: 'B1' });
    expect(calls).toEqual(['b1 p0', 'b1 p1', 'b1 p2']);
    expect(scan.found[member(250)]).toMatchObject({ rank: 251 });
    expect(scan.complete).toBe(false);
  });

  it('reads every page when someone is missing, then reports a complete scan', async () => {
    const calls: string[] = [];
    fakeBoards({ b2: 3 }, calls);
    const missing = id('9');
    const progress: number[] = [];
    const scan = await scanBoard('e', 'w', 'b2', [missing], {
      final: true,
      boardLabel: 'B2',
      onProgress: (d) => progress.push(d),
    });
    expect(calls).toHaveLength(3);
    expect(progress).toEqual([1, 2, 3]);
    expect(scan).toMatchObject({ complete: true, pagesScanned: 3, found: {} });
    // Final scans are kept, so asking again costs nothing.
    expect(cachedScan('e', 'w', 'b2', [missing])).toBe(scan);
    calls.length = 0;
    await scanBoard('e', 'w', 'b2', [missing], { final: true, boardLabel: 'B2' });
    expect(calls).toEqual([]);
  });

  it('can be stopped', async () => {
    fakeBoards({ b3: 50 }, []);
    const ctl = new AbortController();
    ctl.abort();
    await expect(
      scanBoard('e', 'w', 'b3', [id('9')], { final: true, boardLabel: 'B3', signal: ctl.signal }),
    ).rejects.toThrow('Aborted');
  });
});

describe('scanWindow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tries the top tier first, skips unscored boards, and marks the session checked when done', async () => {
    const calls: string[] = [];
    const member = fakeBoards({ low: 2, high: 1 }, calls);
    const target = member(1000 + 5); // on board "high" (second key => offset 1000), page 0
    const scans = await scanWindow('ew', 'ww', [target], { final: true });
    expect(calls).toEqual(['high p0']);
    expect(scans).toHaveLength(1);
    expect(isWindowChecked('ew', 'ww', target)).toBe(true);
    expect(allScans().some((s) => s.windowId === 'ww' && s.found[target])).toBe(true);
  });

  it('does not mark a session checked if the pass was stopped', async () => {
    fakeBoards({ t1: 5 }, []);
    const ctl = new AbortController();
    ctl.abort();
    await expect(scanWindow('ex', 'wx', [id('8')], { final: true, signal: ctl.signal })).rejects.toThrow();
    expect(isWindowChecked('ex', 'wx', id('8'))).toBe(false);
  });
});

describe('dedupeTeams', () => {
  it("keeps a team's first row when it shows up on two pages", () => {
    const row = (teamKey: string, rank: number): Entry => ({
      teamKey,
      rank,
      members: [],
      points: 0,
      matches: 0,
      victories: 0,
      elims: 0,
      avgPlace: null,
      sessions: [],
    });
    expect(dedupeTeams([row('a', 100), row('b', 101), row('a', 102)]).map((e) => [e.teamKey, e.rank])).toEqual([
      ['a', 100],
      ['b', 101],
    ]);
  });
});
