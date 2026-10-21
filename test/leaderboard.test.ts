// Leaderboard parsing, scoring and boards against the anonymized live captures.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardInfos, boardRules, defaultBoard, parseScoreLocation, windowLocations } from '../lib/epic/boards';
import { liteEntry, mergeCumulative, normalizeEntries, pointSplit, teamKeyOf } from '../lib/epic/leaderboard';
import { findWindow, regionForEvent } from '../lib/epic/schedule';
import {
  parseCutoffs,
  parsePayouts,
  parseRules,
  sessionPoints,
  statNames,
  summarizeScoring,
} from '../lib/epic/scoring';
import type { Entry } from '../lib/types';

const load = (capture: string, f: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures/epic', capture, f), 'utf8'));

// first: final Slender Man Cup ZB (BR, duos) and a Ranked Cup main board.
const BR = load('first', 'events-download-BR.json');
const FINAL = { event: 'epicgames_S42_SlenderManCup_ZB_BR', window: 'S42_SlenderManCup_ZB_BR' };
// second: a live Ranked Cup window with all eight tier boards.
const NAC2 = load('second', 'events-download-NAC.json');
const RANKED = { event: 'epicgames_S42_RankedCupSoloReload_NAW', window: 'S42_RankedCupSoloReload_Event8_NAW' };
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite', 'champion', 'unreal'];

const rulesFor = (raw: unknown, ev: string, win: string, instance = win) => {
  const loc = windowLocations(raw, ev, win).find((l) => l.instance === instance)!;
  return boardRules(raw, loc, instance === win ? findWindow(raw, ev, win)?.templateRules : undefined);
};

describe('scoring rules reproduce Epic totals', () => {
  it('on a regular board (score-location rules, not the template)', () => {
    const rules = rulesFor(BR, FINAL.event, FINAL.window);
    const template = parseRules(findWindow(BR, FINAL.event, FINAL.window)!.templateRules);
    expect(rules).not.toEqual(template);
    const raw = load('first', 'leaderboard-final-p0.json') as { entries: Record<string, unknown>[] };
    for (const e of raw.entries) {
      const sessions = e.sessionHistory as { trackedStats: Record<string, unknown> }[];
      expect(sessions.reduce((n, s) => n + sessionPoints(s.trackedStats, rules), 0)).toBe(e.pointsEarned);
    }
  });

  it('on every Ranked Cup tier board, using tier-prefixed stats', () => {
    for (const tier of TIERS) {
      const instance = windowLocations(NAC2, RANKED.event, RANKED.window).find((l) =>
        l.instance.toLowerCase().endsWith(`_${tier}`),
      )!.instance;
      const rules = rulesFor(NAC2, RANKED.event, RANKED.window, instance);
      expect(statNames(rules).place).toBe(`${tier.toUpperCase()}_PLACEMENT_STAT_INDEX`);
      const entries = normalizeEntries(load('second', `leaderboard-live-board-2_${tier}.json`), rules);
      expect(entries.length, tier).toBeGreaterThan(0);
      for (const e of entries)
        expect(
          e.sessions.reduce((n, s) => n + (s.points ?? 0), 0),
          `${tier} #${e.rank}`,
        ).toBe(e.points);
    }
  });

  it('summarizes rules into per-place and per-elimination points', () => {
    const summary = summarizeScoring(rulesFor(BR, FINAL.event, FINAL.window))!;
    expect(summary.placement[0]).toEqual({ place: 1, points: 60 });
    expect(summary.placement.find((p) => p.place === 2)).toEqual({ place: 2, points: 50 });
    expect(summary.placement[summary.placement.length - 1]).toEqual({ place: 15, points: 3 });
    expect(summary.elims.slice(0, 3)).toEqual([
      { elims: 1, points: 2 },
      { elims: 2, points: 4 },
      { elims: 3, points: 6 },
    ]);
    expect(summary.elims).toHaveLength(10);
    expect(summarizeScoring([])).toBeNull();
  });

  it('counts multiplicative elimination points past their key (Ranked Cup tiers have no cap)', () => {
    const elite = windowLocations(NAC2, RANKED.event, RANKED.window).find((l) =>
      l.instance.toLowerCase().endsWith('_elite'),
    )!.instance;
    const rules = rulesFor(NAC2, RANKED.event, RANKED.window, elite);
    const { elims } = statNames(rules);
    expect(rules.find((r) => r.stat === elims)!.tiers).toEqual([{ key: 1, points: 1, multiplicative: true }]);
    const summary = summarizeScoring(rules)!;
    expect(summary.elims).toHaveLength(100);
    expect(summary.elims[11]).toEqual({ elims: 12, points: 12 });
  });
});

describe('normalizeEntries', () => {
  const entries = normalizeEntries(load('first', 'leaderboard-final-p0.json'), rulesFor(BR, FINAL.event, FINAL.window));

  it('builds one row per team with stats from its matches', () => {
    expect(entries).toHaveLength(100);
    const first = entries[0]!;
    expect(first.rank).toBe(1);
    expect(first.members).toHaveLength(2);
    expect(first.teamKey).toBe(teamKeyOf(first.members.map((m) => m.id)));
    expect(first.matches).toBe(first.sessions.length);
    expect(first.victories).toBe(first.sessions.filter((s) => s.place === 1).length);
    expect(first.elims).toBe(first.sessions.reduce((n, s) => n + s.elims, 0));
    expect(first.avgPlace).toBeGreaterThan(0);
    const ends = first.sessions.map((s) => s.endedAt);
    expect(ends).toEqual([...ends].sort());
    // Each game keeps Epic's match ID and how long the team survived.
    expect(first.sessions.every((s) => /^[0-9a-f]{32}$/.test(s.sessionId))).toBe(true);
    expect(first.sessions[0]!.timeAlive).toBeGreaterThan(60);
  });

  it('shares match IDs between teams that played the same game', () => {
    const seen = new Map<string, number>();
    for (const e of entries) for (const s of e.sessions) seen.set(s.sessionId, (seen.get(s.sessionId) ?? 0) + 1);
    // An open cup's top 100 met in some lobbies, but most games are one team's own.
    expect(Math.max(...seen.values())).toBeGreaterThan(5);
    expect([...seen.values()].filter((n) => n === 1).length).toBeGreaterThan(seen.size / 2);
  });

  it('reads places from unprefixed stats on a Ranked Cup main board, where nothing scores', () => {
    const main = rulesFor(
      load('first', 'events-download-NAC.json'),
      'epicgames_S42_RankedCupSoloReload_NAC',
      'S42_RankedCupSoloReload_Event8_NAC',
    );
    expect(main).toEqual([]);
    const rows = normalizeEntries(load('first', 'leaderboard-live-p0.json'), main);
    expect(rows.every((r) => r.points === 0)).toBe(true);
    expect(rows.some((r) => r.sessions.some((s) => s.place !== null))).toBe(true);
    expect(rows[0]!.sessions[0]!.points).toBeNull();
  });

  it("splits each team's points into placement and eliminations, as Epic does", () => {
    for (const e of entries) {
      const { placement, elims, other } = e.pointSplit!;
      expect(placement + elims + other).toBe(e.points);
    }
    expect(entries[0]!.pointSplit).toMatchObject({
      placement: expect.any(Number),
      elims: expect.any(Number),
      other: 0,
    });
    expect(entries[0]!.pointSplit!.elims).toBeGreaterThan(0);
    // Ranked Cup tier boards prefix their stats with the tier.
    const tier = normalizeEntries(load('second', 'leaderboard-live-board-2_unreal.json'), []);
    expect(tier.every((e) => e.pointSplit!.placement + e.pointSplit!.elims + e.pointSplit!.other === e.points)).toBe(
      true,
    );
    expect(tier.some((e) => e.pointSplit!.placement > 0 && e.pointSplit!.elims > 0)).toBe(true);
    expect(pointSplit(undefined)).toBeUndefined();
  });

  it("keeps each game's points on lite rows, which add up to the team's total (D29)", () => {
    const lite = entries.map(liteEntry);
    expect(lite[0]!.sessions).toEqual([]);
    expect(lite[0]!.members.every((m) => m.name === undefined)).toBe(true);
    lite.forEach((e, i) => {
      expect(e.gamePoints).toEqual(entries[i]!.sessions.map((s) => s.points));
      expect(e.gamePoints!.reduce((a, b) => a + b, 0)).toBe(e.points);
    });
    // Unscored boards have no game points to rank by.
    const unscored = normalizeEntries(load('first', 'leaderboard-live-p0.json'), []).map(liteEntry);
    expect(unscored.some((e) => e.matches > 0 && e.gamePoints)).toBe(false);
  });

  it('skips malformed rows', () => {
    expect(normalizeEntries({ entries: [{ rank: 1 }, { teamAccountIds: ['a'] }, null] }, [])).toEqual([]);
  });
});

describe('boards', () => {
  it('lists a Ranked Cup window as an unscored main board plus eight scored tiers, defaulting to the top tier', () => {
    const boards = boardInfos(
      NAC2,
      RANKED.event,
      RANKED.window,
      findWindow(NAC2, RANKED.event, RANKED.window)?.templateRules,
    );
    expect(boards.map((b) => b.label)).toEqual([
      'Overall',
      'Bronze',
      'Silver',
      'Gold',
      'Platinum',
      'Diamond',
      'Elite',
      'Champion',
      'Unreal',
    ]);
    expect(boards[0]).toMatchObject({ kind: 'main', hasPoints: false, scoring: null });
    expect(boards.slice(1).every((b) => b.kind === 'tier' && b.hasPoints && b.scoring)).toBe(true);
    expect(boards.slice(1).every((b) => b.payouts.length > 0)).toBe(true);
    expect(boards[0]!.cutoffs).toEqual([]);
    const unreal = boards[boards.length - 1]!;
    expect(unreal.cutoffs.filter((c) => c.kind === 'skin')).toHaveLength(1);
    expect(unreal.cutoffs.every((c) => c.kind === 'skin' || c.kind === 'item')).toBe(true);
    expect(defaultBoard(boards)).toBe('S42_RankedCupSoloReload_Event8_NAW_2_unreal');
  });

  it('marks the FNCS cumulative board as computed', () => {
    const NAC = load('first', 'events-download-NAC.json');
    const boards = boardInfos(NAC, 'epicgames_S42_FNCSSolo_Final_NAC', 'S42_FNCSSolo_Final_Day1_NAC');
    expect(boards.map((b) => [b.kind, b.id, b.computed])).toEqual([
      ['main', 'S42_FNCSSolo_Final_Day1_NAC', false],
      ['cumulative', 'cumulative', true],
    ]);
    expect(defaultBoard(boards)).toBe('S42_FNCSSolo_Final_Day1_NAC');
  });

  it('parses score location keys', () => {
    expect(parseScoreLocation('Fortnite:cumulative:epicgames_X_cumulative')).toEqual({
      key: 'Fortnite:cumulative:epicgames_X_cumulative',
      group: 'cumulative',
      instance: 'epicgames_X_cumulative',
    });
    expect(parseScoreLocation('nope')).toBeUndefined();
  });

  it('picks the schedule region from the event ID', () => {
    expect(regionForEvent('epicgames_S42_RankedCupSolo_NAW')).toBe('NAW');
    expect(regionForEvent('epicgames_Bog_Official')).toBe('NAE');
  });
});

describe('payouts', () => {
  const NAC = load('first', 'events-download-NAC.json') as { payoutTables: Record<string, unknown> };

  it('labels cash and qualification rewards', () => {
    const round2 = parsePayouts(NAC.payoutTables.S42_ReloadCashCup_DuosZB_Event5Round2_NAC);
    expect(round2[0]).toMatchObject({ basis: 'rank', threshold: 1, rewards: ['$600'], qualifies: false });
    const round1 = parsePayouts(NAC.payoutTables.S42_ReloadCashCup_DuosZB_Event5Round1_NAC);
    expect(round1.find((t) => t.qualifies)?.rewards[0]).toMatch(
      /^Qualifies for Reload Cash Cup Duos ZB Event 5 Round 2/,
    );
  });

  it('keeps which table each tier is in, and its cash in dollars', () => {
    const cash = parsePayouts(NAC.payoutTables.S42_ReloadCashCup_DuosZB_Event5Round2_NAC);
    expect(cash.map((t) => [t.threshold, t.usd])).toEqual([
      [1, 600],
      [2, 450],
      [3, 300],
      [4, 200],
      [5, 150],
      [8, 100],
    ]);
    // Last chance: a points table and a rank table, both qualifying, no cash.
    const lcq = parsePayouts(NAC.payoutTables.epicgames_S42_FNCSSolo_LastChanceQualifier_NAC);
    expect(lcq.map((t) => [t.basis, t.table, t.usd])).toEqual([
      ['points', 0, 0],
      ['rank', 1, 0],
    ]);
  });

  it('draws one cutoff per next round, one for the last paid place, and one per item tier', () => {
    const t = NAC.payoutTables;
    expect(parseCutoffs(t.S42_ReloadCashCup_DuosZB_Event5Round1_NAC)).toEqual([
      {
        basis: 'rank',
        threshold: 20,
        kind: 'qualify',
        label: 'Qualifies for Reload Cash Cup Duos ZB Event 5 Round 2 NAC',
      },
    ]);
    // Six cash tiers (1st to 8th) make a single line.
    expect(parseCutoffs(t.S42_ReloadCashCup_DuosZB_Event5Round2_NAC)).toEqual([
      { basis: 'rank', threshold: 8, kind: 'cash', label: 'Cash prizes' },
    ]);
    // The 0-point entry and lockout tokens every player gets draw no line.
    expect(parseCutoffs(t.S43_FNCSSoloReloadQualifiers_Qual1Round1Day2_NAC)).toEqual([
      { basis: 'rank', threshold: 2000, kind: 'qualify', label: 'Qualifies for FNCSSolo Reload Qual 1 Round 2 NAC' },
    ]);
    // Last chance: reach 1,000 points or finish top 22.
    expect(parseCutoffs(t.epicgames_S42_FNCSSolo_LastChanceQualifier_NAC).map((c) => [c.basis, c.threshold])).toEqual([
      ['points', 1000],
      ['rank', 22],
    ]);
    // A Ranked Cup tier: the top 4 win the skin, the line players chase; the rest are item tiers.
    expect(parseCutoffs(t.epicgames_S42_RankedCupSolo_NAC_1_Diamond)).toEqual([
      { basis: 'rank', threshold: 4, kind: 'skin', label: 'Skin' },
      { basis: 'percentile', threshold: 0.05, kind: 'item', label: 'Pickaxe' },
      { basis: 'percentile', threshold: 0.15, kind: 'item', label: 'Style' },
      { basis: 'percentile', threshold: 0.3, kind: 'item', label: 'Back Bling' },
    ]);
    // A cup whose top 200 win a skin with three more cosmetics: one skin line, labelled with all four.
    expect(parseCutoffs(t.S42_ChampionTealKnightFNCSCup_ZB_NAW)).toEqual([
      { basis: 'rank', threshold: 200, kind: 'skin', label: 'Skin, Pickaxe, Back Bling, Wrap' },
      { basis: 'points', threshold: 8, kind: 'item', label: 'Emote' },
      { basis: 'points', threshold: 40, kind: 'item', label: 'Back Bling' },
    ]);
    expect(parseCutoffs(undefined)).toEqual([]);
  });

  it('keeps the furthest qualifying tier and merges rounds reached from the same place', () => {
    const token = (value: string) => ({ rewardType: 'token', value, quantity: 1 });
    const cutoffs = parseCutoffs([
      {
        scoringType: 'rank',
        ranks: [
          { threshold: 5, payouts: [token('S42_Final'), { rewardType: 'ecomm', value: 'USD', quantity: 100 }] },
          { threshold: 50, payouts: [token('S42_Final')] },
          { threshold: 50, payouts: [token('S42_Bonus')] },
        ],
      },
      { scoringType: 'value', ranks: [{ threshold: 300, payouts: [token('S42_Final')] }] },
      { scoringType: 'value', ranks: [{ threshold: 250, payouts: [token('S42_Final')] }] },
    ]);
    expect(cutoffs).toEqual([
      { basis: 'points', threshold: 250, kind: 'qualify', label: 'Qualifies for Final' },
      { basis: 'rank', threshold: 50, kind: 'qualify', label: 'Qualifies for Final; Qualifies for Bonus' },
      { basis: 'rank', threshold: 5, kind: 'cash', label: 'Cash prizes' },
    ]);
  });

  it('handles percentile tables and ignores junk', () => {
    const t = parsePayouts([
      {
        scoringType: 'percentile',
        ranks: [{ threshold: 0.05, payouts: [{ rewardType: 'game', value: 'AthenaGlider:glider_x' }] }],
      },
      { scoringType: 'mystery', ranks: [] },
    ]);
    expect(t).toEqual([
      { basis: 'percentile', threshold: 0.05, table: 0, rewards: ['Glider'], qualifies: false, usd: 0 },
    ]);
  });
});

describe('mergeCumulative', () => {
  const row = (team: string, points: number, place: number, endedAt: string): Entry => ({
    rank: 0,
    teamKey: team,
    members: [{ id: team }],
    points,
    matches: 1,
    victories: place === 1 ? 1 : 0,
    elims: 1,
    avgPlace: place,
    sessions: [
      { sessionId: `${team}${endedAt}`, endedAt, place, elims: 1, points, victory: place === 1, timeAlive: 600 },
    ],
  });

  it('sums points per team across sessions and re-ranks, sharing ranks on ties', () => {
    const day1 = [row('a', 50, 1, '2026-10-20T20:00:00Z'), row('b', 40, 2, '2026-10-20T20:00:00Z')];
    const day2 = [
      row('b', 30, 1, '2026-10-21T20:00:00Z'),
      row('c', 20, 3, '2026-10-21T20:00:00Z'),
      row('a', 20, 5, '2026-10-21T20:00:00Z'),
    ];
    const merged = mergeCumulative([day1, day2]);
    // a and b tie on points and Victory Royales; b's better average place breaks it.
    expect(merged.map((e) => [e.teamKey, e.points, e.rank])).toEqual([
      ['b', 70, 1],
      ['a', 70, 1],
      ['c', 20, 3],
    ]);
    expect(merged[0]!.matches).toBe(2);
    expect(merged[0]!.avgPlace).toBe(1.5);
  });

  it('adds up the point splits, when every session has one', () => {
    const a1 = { ...row('a', 50, 1, '2026-10-20T20:00:00Z'), pointSplit: { placement: 30, elims: 20, other: 0 } };
    const a2 = { ...row('a', 20, 5, '2026-10-21T20:00:00Z'), pointSplit: { placement: 5, elims: 15, other: 0 } };
    expect(mergeCumulative([[a1], [a2]])[0]!.pointSplit).toEqual({ placement: 35, elims: 35, other: 0 });
    expect(mergeCumulative([[a1], [row('a', 20, 5, '2026-10-21T20:00:00Z')]])[0]!.pointSplit).toBeUndefined();
  });
});
