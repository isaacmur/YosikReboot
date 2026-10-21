// Browser-side logic that doesn't need a DOM: follow list parsing/import and
// the board scanner (with fetch faked). localStorage is absent here, so the
// stores run in memory, which is also how they behave in a private window.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cutoff, Entry, LeaderboardPage, WindowDetail } from '../lib/types';
import {
  boardRows,
  cutoffTitle,
  entryAtRank,
  linesAfter,
  pageOfRank,
  pageRuns,
  pinnedRows,
  placeCutoffs,
  watchedIds,
} from '../src/board';
import { boardCsv, fileName, toCsv } from '../src/csv';
import { dayIndex, formatDuration, plural, topShare } from '../src/format';
import { eventPath, inRegion, regionOf } from '../src/links';
import { addFollow, exportFollows, getFollows, importFollows, parseFollows, removeFollow, setMe } from '../src/follows';
import { boardMoves, forgetBoard, movesFor, recordPage } from '../src/movement';
import {
  allScans,
  cachedScan,
  isWindowChecked,
  lastScan,
  scanBoard,
  scanOrder,
  scanWindow,
  searchBoard,
} from '../src/scan';
import { getTeams, parseTeams, removeTeam, saveTeam, teamKeyOf } from '../src/teams';

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
    expect(added).toEqual({ follows: 1, teams: 0 });
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
          {
            id: 'w',
            kind: 'main',
            label: 'Overall',
            computed: false,
            hasPoints: false,
            scoring: null,
            payouts: [],
            cutoffs: [],
          },
          ...Object.keys(boards).map((b) => ({
            id: b,
            kind: 'tier' as const,
            label: b,
            computed: false,
            hasPoints: true,
            scoring: null,
            payouts: [],
            cutoffs: [],
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

  it('reads a few pages at a time and starts no more once everyone is found', async () => {
    const calls: string[] = [];
    const member = fakeBoards({ b1: 10 }, calls);
    const scan = await scanBoard('e', 'w', 'b1', [member(250)], { final: false, boardLabel: 'B1' });
    // Page 0 says how many pages there are; then four at a time, so pages 3 and 4 were already on their way.
    expect(calls).toEqual(['b1 p0', 'b1 p1', 'b1 p2', 'b1 p3', 'b1 p4']);
    expect(scan.found[member(250)]).toMatchObject({ rank: 251 });
    expect(scan.complete).toBe(false);
  });

  it('answers a later search from the pages it already read', async () => {
    const calls: string[] = [];
    const member = fakeBoards({ b4: 10 }, calls);
    await scanBoard('e', 'w', 'b4', [member(450)], { final: true, boardLabel: 'B4' });
    calls.length = 0;
    const scan = await scanBoard('e', 'w', 'b4', [member(120)], { final: true, boardLabel: 'B4' });
    expect(calls).toEqual([]);
    expect(scan.found[member(120)]).toMatchObject({ rank: 121 });
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

  it('searches for a name without replacing the saved search of your follows', async () => {
    const calls: string[] = [];
    const member = fakeBoards({ b5: 4 }, calls);
    const saved = await scanBoard('e', 'w', 'b5', [member(30)], { final: true, boardLabel: 'B5' });
    const result = await searchBoard('e', 'w', 'b5', [member(330)], { final: true });
    expect(result.found[member(330)]).toMatchObject({ rank: 331 });
    expect(lastScan('e', 'w', 'b5')).toBe(saved);
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

describe('formatting and links', () => {
  it('counts calendar days in the chosen time zone', () => {
    // 11 PM in New York on Oct 21 is already Oct 22 in UTC.
    const late = '2026-10-22T03:00:00Z';
    expect(dayIndex(late, 'America/New_York')).toBe(dayIndex('2026-10-21T12:00:00Z', 'UTC'));
    expect(dayIndex(late, 'UTC') - dayIndex(late, 'America/New_York')).toBe(1);
    expect(plural(1, 'win')).toBe('1 win');
    expect(plural(1200, 'game')).toBe('1,200 games');
  });

  it('swaps the region suffix to find the same event elsewhere', () => {
    expect(regionOf('epicgames_S42_PurgeCup_ZB_EU')).toBe('EU');
    expect(regionOf('epicgames_Bog_Official')).toBeUndefined();
    expect(inRegion('epicgames_S42_PurgeCup_ZB_EU', 'NAC')).toBe('epicgames_S42_PurgeCup_ZB_NAC');
    expect(inRegion('S42_ArenaTestCup_Event2_EU', 'ASIA')).toBe('S42_ArenaTestCup_Event2_ASIA');
    expect(inRegion('epicgames_Bog_Official', 'EU')).toBeUndefined();
    expect(eventPath('a_EU', 'b_EU', 'tab=rules')).toBe('/events/a_EU/b_EU?tab=rules');
  });
});

// --- Phase 3: board pages, cutoffs, movement, pins, teams, CSV ---------------------

const entry = (teamKey: string, rank: number, points = 0, names?: string[]): Entry => ({
  teamKey,
  rank,
  members: teamKey.split(':').map((m, i) => ({ id: m, ...(names?.[i] ? { name: names[i] } : {}) })),
  points,
  matches: 3,
  victories: 0,
  elims: 2,
  avgPlace: 10,
  sessions: [],
});

const page = (n: number, fetchedAt: string, entries: Entry[], totalPages = 10): LeaderboardPage => ({
  eventId: 'e',
  windowId: 'w',
  board: 'b',
  page: n,
  totalPages,
  fetchedAt,
  entries,
});

describe('board pages', () => {
  it('shows each team once, from the most recently fetched page', () => {
    const rows = boardRows({
      1: page(1, '2026-10-21T20:01:00Z', [entry('a', 101), entry('b', 102)]),
      0: page(0, '2026-10-21T20:02:00Z', [entry('c', 99), entry('a', 100)]),
    });
    expect(rows.map((r) => [r.page, r.entry.teamKey, r.entry.rank])).toEqual([
      [0, 'c', 99],
      [0, 'a', 100],
      [1, 'b', 102],
    ]);
  });

  it('groups loaded pages into runs and finds pages by rank', () => {
    expect(pageRuns([14, 0, 2, 1, 15, 1])).toEqual([
      [0, 1, 2],
      [14, 15],
    ]);
    expect([1, 100, 101, 9_999, 10_000, 20_000].map(pageOfRank)).toEqual([0, 0, 1, 99, 99, 99]);
    const pages = [page(0, 't', [entry('a', 1, 50)]), page(3, 't', [entry('b', 301, 20)])];
    expect(entryAtRank(301, pages)?.teamKey).toBe('b');
    expect(entryAtRank(2, pages)).toBeUndefined();
  });
});

describe('cutoff lines', () => {
  const c = (basis: Cutoff['basis'], threshold: number, kind: Cutoff['kind'] = 'qualify'): Cutoff => ({
    basis,
    threshold,
    kind,
    label: 'x',
  });

  it('places rank lines as given, and percentile lines from the team count', () => {
    const lines = [c('rank', 20), c('percentile', 0.05, 'item'), c('points', 300)];
    // 3 pages, last one not loaded: about 250 teams.
    expect(placeCutoffs(lines, 3).map((l) => [l.basis, l.rank, l.approx])).toEqual([
      ['rank', 20, false],
      ['percentile', 12, true],
      ['points', null, false],
    ]);
    // The last page holds 41: exactly 241 teams.
    expect(placeCutoffs(lines, 3, 41)[1]).toMatchObject({ rank: 12, approx: false });
    expect(placeCutoffs([c('percentile', 0.5)], 3, 41)[0]!.rank).toBe(120);
    // A full board (100 pages) doesn't say how many teams there are.
    expect(placeCutoffs(lines, 100).map((l) => l.basis)).toEqual(['rank', 'points']);
    expect(cutoffTitle(c('rank', 1000))).toBe('Top 1,000');
    expect(cutoffTitle(c('percentile', 0.05))).toBe('Top 5%');
    expect(cutoffTitle(c('points', 1000))).toBe('1,000 pts');
  });

  it('draws a line between the last row inside it and the first row past it', () => {
    const rows = [entry('a', 19, 310), entry('b', 20, 300), entry('c', 21, 290), entry('d', 22, 280)];
    const lines = placeCutoffs([c('rank', 20), c('points', 290, 'item')], 1);
    const after = linesAfter(rows, lines);
    expect([...after.entries()].map(([k, ls]) => [k, ls.map((l) => l.basis)])).toEqual([
      ['b', ['rank']],
      ['c', ['points']],
    ]);
    // The run ends exactly on the line: still drawn. Ends before it: not drawn.
    expect(linesAfter(rows.slice(0, 2), lines).get('b')?.length).toBe(1);
    expect(linesAfter(rows.slice(0, 1), lines).size).toBe(0);
  });
});

describe('pinned rows', () => {
  const me = 'a'.repeat(32);
  const mate = 'b'.repeat(32);
  const other = 'c'.repeat(32);
  const far = 'd'.repeat(32);

  it('pins loaded rows first, then rows from the last search, and lists who is missing', () => {
    const rows = [entry(teamKeyOf([me, mate]), 12, 80)];
    const found = {
      [me]: { rank: 400, points: 10, matches: 1, victories: 0, elims: 0, avgPlace: 50, memberIds: [mate, me] },
      [far]: { rank: 2500, points: 5, matches: 1, victories: 0, elims: 0, avgPlace: 70, memberIds: [far] },
    };
    const { pinned, missing } = pinnedRows(rows, found, [me, mate, far, other]);
    expect(pinned.map((p) => [p.teamKey, p.rank, p.source])).toEqual([
      [teamKeyOf([me, mate]), 12, 'board'],
      [far, 2500, 'search'],
    ]);
    expect(missing).toEqual([other]);
  });

  it("watches follows and saved teams' players", () => {
    const teams = parseTeams([{ name: 'Duo', members: [{ id: me }, { id: far }] }]);
    expect(watchedIds([me, mate], teams)).toEqual([me, mate, far]);
  });
});

describe('movement', () => {
  afterEach(() => forgetBoard('mv'));

  it('compares each page with the ranks it showed before, across pages', () => {
    recordPage('mv', page(0, '2026-10-21T20:00:00Z', [entry('a', 1), entry('b', 2), entry('c', 3)]));
    recordPage('mv', page(1, '2026-10-21T20:00:00Z', [entry('d', 101)]));
    // Nothing before the first look.
    expect(movesFor('mv', page(0, '2026-10-21T20:00:00Z', [entry('a', 1)])).size).toBe(0);

    const next = page(0, '2026-10-21T20:01:00Z', [entry('b', 1), entry('d', 2), entry('a', 3), entry('e', 4)]);
    recordPage('mv', next);
    expect(Object.fromEntries(movesFor('mv', next))).toEqual({ b: 1, d: 99, a: -2, e: 'new' });
    // The same data again (a CDN copy) keeps the arrows.
    recordPage('mv', next);
    expect(movesFor('mv', next).get('d')).toBe(99);
    // So does a newer fetch where nobody moved: the baseline stays the last real change.
    const unchanged = { ...next, fetchedAt: '2026-10-21T20:01:30Z' };
    recordPage('mv', unchanged);
    expect(movesFor('mv', unchanged).get('d')).toBe(99);
    expect([...boardMoves('mv', { 0: next }, [{ page: 0, entry: next.entries[2]! }])]).toEqual([['a', -2]]);
  });

  it('forgets a board once it is final', () => {
    recordPage('mv', page(0, '2026-10-21T20:00:00Z', [entry('a', 1)]));
    const later = page(0, '2026-10-21T20:01:00Z', [entry('a', 2)]);
    recordPage('mv', later);
    expect(movesFor('mv', later).get('a')).toBe(-1);
    forgetBoard('mv');
    expect(movesFor('mv', later).size).toBe(0);
  });
});

describe('teams', () => {
  const a = 'a'.repeat(32);
  const b = 'b'.repeat(32);
  afterEach(() => {
    for (const t of getTeams()) removeTeam(t.key);
    for (const f of getFollows()) removeFollow(f.id);
  });

  it('keys teams like board rows and rejects bad ones', () => {
    const teams = parseTeams([
      {
        name: ' Duo ',
        members: [
          { id: b, name: 'B' },
          { id: a, name: 'A' },
        ],
      },
      { name: 'Again', members: [{ id: a }, { id: b }] },
      { name: 'Solo', members: [{ id: a }] },
      { name: 'Twice', members: [{ id: a }, { id: a }] },
      { name: '', members: [{ id: a }, { id: b }] },
      'junk',
    ]);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ key: `${a}:${b}`, name: 'Duo' });
  });

  it('renames a saved team and travels with the follow list', () => {
    saveTeam('First', [
      { id: a, name: 'A' },
      { id: b, name: 'B' },
    ]);
    saveTeam('Renamed', [
      { id: b, name: 'B' },
      { id: a, name: 'A' },
    ]);
    expect(getTeams().map((t) => t.name)).toEqual(['Renamed']);
    addFollow(a, 'A');
    const exported = exportFollows();
    removeTeam(getTeams()[0]!.key);
    removeFollow(a);
    expect(importFollows(exported)).toEqual({ follows: 1, teams: 1 });
    expect(getTeams()[0]!.name).toBe('Renamed');
    // Version 1 files have no teams.
    expect(importFollows(JSON.stringify({ version: 1, follows: [{ id: b, name: 'B' }] }))).toEqual({
      follows: 1,
      teams: 0,
    });
  });
});

describe('CSV', () => {
  it('quotes what needs quoting and defuses formulas', () => {
    expect(toCsv([['a,b', 'say "hi"', '=1+1', '-x', 'plain', 12, null]])).toBe(
      `"a,b","say ""hi""",'=1+1,'-x,plain,12,\r\n`,
    );
  });

  it('writes one line per team, best rank first', () => {
    const csv = boardCsv([entry('y:z', 2, 40, ['Yan', 'Zed']), entry('x', 1, 50, ['Xi'])], (k) =>
      k === 'y:z' ? 'YZ' : undefined,
    );
    expect(csv.split('\r\n')).toEqual([
      'Rank,Team,Players,Account IDs,Points,Games,Wins,Elims,Avg place',
      '1,,Xi,x,50,3,0,2,10',
      '2,YZ,Yan / Zed,y z,40,3,0,2,10',
      '',
    ]);
    expect(fileName(['Solo Ranked Cup', 'Event 8', 'Unreal'])).toBe('solo-ranked-cup-event-8-unreal.csv');
  });
});

describe('scan order', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads around the hinted pages first, then the rest from the top', () => {
    expect(scanOrder(10, [5])).toEqual([5, 4, 6, 3, 7, 0, 1, 2, 8, 9]);
    expect(scanOrder(3, [0, 9])).toEqual([0, 1, 2]);
    expect(scanOrder(4)).toEqual([0, 1, 2, 3]);
  });

  it('finds a player who moved a page in one round of reads', async () => {
    const calls: string[] = [];
    const member = fakeBoards({ hb: 40 }, calls);
    const scan = await scanBoard('eh', 'wh', 'hb', [member(2_150)], { final: false, boardLabel: 'H', hints: [22] });
    expect(calls).toEqual(['hb p22', 'hb p21', 'hb p23', 'hb p20', 'hb p24']);
    expect(scan).toMatchObject({ complete: false, pagesScanned: 5 });
    expect(lastScan('eh', 'wh', 'hb')).toBe(scan);
  });
});

describe('theme setting', () => {
  it('keeps a valid theme and falls back to System', async () => {
    const { parseSettings } = await import('../src/settings');
    expect(parseSettings({ theme: 'light' }).theme).toBe('light');
    expect(parseSettings({ theme: 'purple' }).theme).toBe('system');
    expect(parseSettings(null)).toMatchObject({ region: 'NAE', theme: 'system', refreshSec: 60 });
  });

  it('follows the device only when set to System', async () => {
    const { resolveTheme } = await import('../src/theme');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});

describe('tournament card numbers', () => {
  it('writes time alive in hours and minutes', () => {
    expect(formatDuration(6720)).toBe('1h 52m');
    expect(formatDuration(840)).toBe('14m');
    expect(formatDuration(25)).toBe('25s');
  });

  it('writes Top % with a decimal under 10%', () => {
    expect(topShare(88, 2750)).toBe('Top 3.2%');
    expect(topShare(1, 50_000)).toBe('Top 0.1%');
    expect(topShare(900, 2000)).toBe('Top 45%');
  });
});
