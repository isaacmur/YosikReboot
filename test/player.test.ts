// Player pages (F23): prizes worked out from real payout tables, and the chart
// helpers (F29).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePayouts } from '../lib/epic/scoring';
import type { EventWindow, LeaderboardPage, WindowDetail } from '../lib/types';
import { finishedSessions, loadCutoffs, savedCutoffs } from '../src/cutoffHistory';
import { logTicks, niceMax, niceTicks, rankTicks } from '../src/scales';
import { formatUsd, prizeFor } from '../src/prizes';

const NAC = JSON.parse(readFileSync(join(__dirname, 'fixtures/epic/first/events-download-NAC.json'), 'utf8')) as {
  payoutTables: Record<string, unknown>;
};
const tiers = (id: string) => parsePayouts(NAC.payoutTables[id]);

describe('prizes', () => {
  it('pays a place its nearest tier at or after it', () => {
    const round2 = tiers('S42_ReloadCashCup_DuosZB_Event5Round2_NAC');
    expect(prizeFor(1, 600, round2).usd).toBe(600);
    expect(prizeFor(5, 400, round2).usd).toBe(150);
    // 6th to 8th share the 8th-place prize; 9th gets nothing.
    expect(prizeFor(6, 390, round2).usd).toBe(100);
    expect(prizeFor(8, 380, round2).usd).toBe(100);
    expect(prizeFor(9, 370, round2)).toEqual({ usd: 0, qualifies: [], items: [] });
    expect(formatUsd(1500)).toBe('$1,500');
  });

  it('qualifies by rank or by points, from separate tables', () => {
    const lcq = tiers('epicgames_S42_FNCSSolo_LastChanceQualifier_NAC');
    expect(prizeFor(22, 300, lcq).qualifies).toHaveLength(1);
    expect(prizeFor(23, 300, lcq).qualifies).toHaveLength(0);
    // 1,000 points qualifies whatever the rank.
    expect(prizeFor(40, 1000, lcq).qualifies).toHaveLength(1);
    const round1 = tiers('S42_ReloadCashCup_DuosZB_Event5Round1_NAC');
    expect(prizeFor(20, 0, round1).qualifies[0]).toMatch(/^Qualifies for Reload Cash Cup/);
  });

  it('skips the 0-point entry tokens and adds up points tiers', () => {
    const quals = tiers('S43_FNCSSoloReloadQualifiers_Qual1Round1Day2_NAC');
    // Everyone who plays gets the 0-point tokens; only the top 2,000 qualify.
    expect(prizeFor(5000, 10, quals).qualifies).toEqual([]);
    expect(prizeFor(1500, 10, quals).qualifies).toHaveLength(1);
    const teal = tiers('S42_ChampionTealKnightFNCSCup_ZB_NAW');
    expect(prizeFor(500, 45, teal).items).toEqual(['Emote', 'Back Bling']);
    expect(prizeFor(500, 10, teal).items).toEqual(['Emote']);
  });

  it('works out percentile tiers only when the team count is known', () => {
    const diamond = tiers('epicgames_S42_RankedCupSolo_NAC_1_Diamond');
    expect(prizeFor(10, 50, diamond, 300).items).toContain('Pickaxe');
    expect(prizeFor(10, 50, diamond).items).toEqual([]);
    expect(prizeFor(3, 50, diamond).items).toContain('Skin');
  });
});

describe('chart scales', () => {
  it('rounds up to a clean top tick', () => {
    expect([0, 1, 7, 46, 120, 251, 999].map(niceMax)).toEqual([1, 1, 10, 50, 200, 500, 1000]);
  });

  it('fits a trend axis around its values', () => {
    expect(niceTicks(596, 609)).toEqual([595, 600, 605, 610]);
    expect(niceTicks(250, 320)).toEqual([250, 275, 300, 325]);
    expect(niceTicks(600, 600)).toEqual([600, 601]);
    expect(niceTicks(0, 90)).toEqual([0, 50, 100]);
  });

  it('puts rank ticks on powers of ten', () => {
    expect(logTicks(12, 2500)).toEqual([10, 100, 1000]);
    expect(logTicks(1, 9)).toEqual([1]);
    // A narrow range of ranks gets whole-number steps instead, never a 0th.
    expect(rankTicks(12, 2500)).toEqual({ ticks: [10, 100, 1000], log: true });
    expect(rankTicks(1, 8)).toEqual({ ticks: [1, 5, 10], log: false });
    expect(rankTicks(230, 355)).toEqual({ ticks: [200, 250, 300, 350, 400], log: false });
  });
});

describe('cutoff history', () => {
  afterEach(() => vi.unstubAllGlobals());
  const w = (id: string, end: string): EventWindow => ({
    id,
    eventId: 'ev',
    round: 1,
    label: id,
    begin: '2026-10-01T00:00:00Z',
    end,
    payoutDelayMin: 30,
    isTBD: false,
    requirements: [],
    stage: 'open',
  });

  it('reads the page each rank line falls on, once, and remembers it', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      const u = new URL(input, 'https://app.test');
      calls.push(`${u.pathname} ${u.searchParams.get('page') ?? ''}`);
      if (u.pathname === '/api/window') {
        const detail: WindowDetail = {
          eventId: 'ev',
          windowId: 'w1',
          defaultBoard: 'w1',
          boards: [
            {
              id: 'w1',
              kind: 'main',
              label: 'Overall',
              computed: false,
              hasPoints: true,
              scoring: null,
              payouts: [],
              cutoffs: [
                { basis: 'rank', threshold: 150, kind: 'qualify', label: 'Qualifies for Round 2' },
                { basis: 'rank', threshold: 8, kind: 'cash', label: 'Cash prizes' },
                { basis: 'points', threshold: 1000, kind: 'qualify', label: 'Qualifies for Final' },
                { basis: 'rank', threshold: 3, kind: 'item', label: 'Glider' },
              ],
            },
          ],
        };
        return Response.json(detail);
      }
      const page = Number(u.searchParams.get('page'));
      const body: LeaderboardPage = {
        eventId: 'ev',
        windowId: 'w1',
        board: 'w1',
        page,
        totalPages: 2,
        fetchedAt: '',
        entries: Array.from({ length: 100 }, (_, i) => ({
          rank: page * 100 + i + 1,
          teamKey: `t${page * 100 + i}`,
          members: [{ id: `t${page * 100 + i}` }],
          points: 500 - page * 100 - i,
          matches: 1,
          victories: 0,
          elims: 0,
          avgPlace: null,
          sessions: [],
        })),
      };
      return Response.json(body);
    });
    const got = await loadCutoffs('ev', w('w1', '2026-10-02T00:00:00Z'));
    expect(got.lines.map((l) => [l.title, l.points])).toEqual([
      ['Top 150 · Qualify', 351],
      ['Top 8 · Paid', 493],
    ]);
    // The window's rules, then pages 1 and 0 (lite); points and item lines read nothing.
    expect(calls).toEqual(['/api/window ', '/api/leaderboard 1', '/api/leaderboard 0']);
    calls.length = 0;
    expect(await loadCutoffs('ev', w('w1', '2026-10-02T00:00:00Z'))).toBe(got);
    expect(savedCutoffs('ev', 'w1')).toBe(got);
    expect(calls).toEqual([]);
  });

  it('lists finished sessions oldest first', () => {
    const now = new Date('2026-10-21T00:00:00Z');
    const list = finishedSessions(
      [w('b', '2026-10-10T00:00:00Z'), w('live', '2026-10-21T01:00:00Z'), w('a', '2026-10-01T00:00:00Z')],
      now,
    );
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
