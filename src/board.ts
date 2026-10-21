// A leaderboard as the pages loaded so far (F14): which rows to show, where the
// loaded pages leave gaps, where cutoff lines fall (F16), and which rows to pin
// for your follows and saved teams (F18, F24).

import type { Cutoff, Entry, LeaderboardPage } from '../lib/types';
import type { FoundRow } from './scan';
import { teamKeyOf, type Team } from './teams';

export const PAGE_SIZE = 100;
/** Epic serves the top 10,000: 100 pages of 100. */
export const MAX_PAGES = 100;

export const pageOfRank = (rank: number) => Math.min(MAX_PAGES - 1, Math.max(0, Math.floor((rank - 1) / PAGE_SIZE)));

export interface BoardRow {
  page: number;
  entry: Entry;
}

/**
 * Rows of the loaded pages, in page order. Ranks shift while a board is live, so
 * a team can turn up on two pages; the copy from the most recently fetched page wins.
 */
export function boardRows(pages: Record<number, LeaderboardPage>): BoardRow[] {
  const nums = Object.keys(pages)
    .map(Number)
    .sort((a, b) => a - b);
  const best = new Map<string, { page: number; at: string }>();
  for (const p of nums) {
    const { fetchedAt, entries } = pages[p]!;
    for (const e of entries) {
      const prev = best.get(e.teamKey);
      if (!prev || fetchedAt > prev.at) best.set(e.teamKey, { page: p, at: fetchedAt });
    }
  }
  return nums.flatMap((p) =>
    pages[p]!.entries.filter((e) => best.get(e.teamKey)?.page === p).map((entry) => ({ page: p, entry })),
  );
}

/** Loaded pages grouped into runs of consecutive pages, e.g. [[0, 1, 2], [14]]. */
export function pageRuns(pages: number[]): number[][] {
  const runs: number[][] = [];
  for (const p of [...new Set(pages)].sort((a, b) => a - b)) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === p - 1) run.push(p);
    else runs.push([p]);
  }
  return runs;
}

export interface PlacedCutoff extends Cutoff {
  /** Last rank inside the line; null for points lines, which are placed by points. */
  rank: number | null;
  /** The rank is estimated from the page count, not counted. */
  approx: boolean;
}

/**
 * Where each cutoff falls. Percentile lines need the number of teams: exact once
 * the last page is loaded (`lastPageSize`), else estimated from the page count.
 * Epic stops at 100 pages without saying how many teams there are past that, so a
 * full board can't place them and they're left out.
 */
export function placeCutoffs(cutoffs: Cutoff[], totalPages: number, lastPageSize?: number): PlacedCutoff[] {
  return cutoffs.flatMap((c): PlacedCutoff[] => {
    if (c.basis === 'rank') return [{ ...c, rank: c.threshold, approx: false }];
    if (c.basis === 'points') return [{ ...c, rank: null, approx: false }];
    if (totalPages < 1 || totalPages >= MAX_PAGES) return [];
    const exact = lastPageSize !== undefined;
    const teams = (totalPages - 1) * PAGE_SIZE + (exact ? lastPageSize : PAGE_SIZE / 2);
    return [{ ...c, rank: Math.max(1, Math.floor(c.threshold * teams)), approx: !exact }];
  });
}

/**
 * Lines to draw after each row of one run of consecutive rows, keyed by team. A
 * rank line goes between the last row inside it and the first row past it, or
 * after the last row of the run if that row sits exactly on the line.
 */
export function linesAfter(rows: Entry[], lines: PlacedCutoff[]): Map<string, PlacedCutoff[]> {
  const out = new Map<string, PlacedCutoff[]>();
  rows.forEach((a, i) => {
    const b = rows[i + 1];
    for (const l of lines) {
      const after =
        l.rank !== null
          ? a.rank <= l.rank && (b ? b.rank > l.rank : a.rank === l.rank)
          : !!b && a.points >= l.threshold && b.points < l.threshold;
      if (after) out.set(a.teamKey, [...(out.get(a.teamKey) ?? []), l]);
    }
  });
  return out;
}

/** The row at a rank on any loaded page. */
export function entryAtRank(rank: number, pages: LeaderboardPage[]): Entry | undefined {
  for (const p of pages) {
    const e = p.entries.find((x) => x.rank === rank);
    if (e) return e;
  }
  return undefined;
}

/** What a summary card calls each kind of line. */
export const CUTOFF_KIND: Record<Cutoff['kind'], string> = {
  qualify: 'Qualify',
  cash: 'Paid',
  skin: 'Skin',
  item: 'Items',
};

/** "Top 20", "Top 5%", "1,000 pts" */
export function cutoffTitle(c: Cutoff): string {
  if (c.basis === 'rank') return `Top ${c.threshold.toLocaleString('en-US')}`;
  if (c.basis === 'percentile') return `Top ${+(c.threshold * 100).toFixed(2)}%`;
  return `${c.threshold.toLocaleString('en-US')} pts`;
}

// --- Pinned follows and teams -----------------------------------------------------

export interface PinnedRow {
  teamKey: string;
  rank: number;
  points: number;
  matches: number;
  victories: number;
  elims: number;
  memberIds: string[];
  /** A loaded page (refreshed with the board) or the last search of all pages. */
  source: 'board' | 'search';
}

/**
 * Rows to pin: every row holding one of `ids` (follows and saved teams' players),
 * from the loaded pages first, else from the last search. `missing` lists the IDs
 * found on neither.
 */
export function pinnedRows(
  rows: Entry[],
  found: Record<string, FoundRow> | undefined,
  ids: string[],
): { pinned: PinnedRow[]; missing: string[] } {
  const pinned = new Map<string, PinnedRow>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const e = rows.find((r) => r.members.some((m) => m.id === id));
    if (e) {
      pinned.set(e.teamKey, {
        teamKey: e.teamKey,
        rank: e.rank,
        points: e.points,
        matches: e.matches,
        victories: e.victories,
        elims: e.elims,
        memberIds: e.members.map((m) => m.id),
        source: 'board',
      });
      continue;
    }
    const f = found?.[id];
    if (!f) {
      missing.push(id);
      continue;
    }
    const teamKey = teamKeyOf(f.memberIds);
    if (!pinned.has(teamKey)) pinned.set(teamKey, { ...f, teamKey, source: 'search' });
  }
  return { pinned: [...pinned.values()].sort((a, b) => a.rank - b.rank), missing };
}

/** Account IDs to look for on a board: your follows and your saved teams' players. */
export function watchedIds(followIds: string[], teams: Team[]): string[] {
  return [...new Set([...followIds, ...teams.flatMap((t) => t.members.map((m) => m.id))])];
}
