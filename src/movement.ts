// Movement arrows (F15): places gained or lost since the last refresh. Each live
// board keeps the ranks it last showed, page by page, in this browser, so the
// arrows also cover the time since you last looked. A team's baseline is the
// newest sighting of it on any page before the data shown. Final boards keep nothing.

import type { Entry, LeaderboardPage } from '../lib/types';
import { createStore } from './store';

/** Places gained (positive) or lost (negative), or 'new' when a team just reached this page. */
export type Move = number | 'new';

interface PageSnap {
  at: string;
  /** Short team key → rank. */
  ranks: Record<string, number>;
}

interface BoardSnaps {
  seen: number;
  pages: Record<string, PageSnap>;
}

const MAX_BOARDS = 4;
const MAX_PAGES_KEPT = 6;

/** The first 10 characters of each member ID tell a board's teams apart and keep the store small. */
const short = (teamKey: string) =>
  teamKey
    .split(':')
    .map((id) => id.slice(0, 10))
    .join(':');

const latest = createStore<Record<string, BoardSnaps>>(
  'yr.lastBoard.v1',
  (r) => (r && typeof r === 'object' ? (r as Record<string, BoardSnaps>) : {}),
  {},
);
/** Each page's snapshot before its latest one, for this visit only. */
const previous = new Map<string, Record<string, PageSnap>>();

/** Keeps the newest `n` entries of a record, by `when`. */
function newest<T>(rec: Record<string, T>, n: number, when: (x: T) => string | number): Record<string, T> {
  const keep = Object.entries(rec)
    .sort((a, b) => (when(b[1]) > when(a[1]) ? 1 : when(b[1]) < when(a[1]) ? -1 : 0))
    .slice(0, n);
  return Object.fromEntries(keep);
}

const sameRanks = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, r]) => b[k] === r);

/**
 * Remembers the ranks on a freshly fetched page. Older data changes nothing, and
 * a refresh where nobody moved keeps the earlier snapshot as the baseline, so the
 * arrows show the last real change rather than vanishing.
 */
export function recordPage(board: string, page: LeaderboardPage, now = Date.now()): void {
  const all = latest.get();
  const snaps = all[board] ?? { seen: now, pages: {} };
  const cur = snaps.pages[page.page];
  if (cur && cur.at >= page.fetchedAt) return;
  const ranks = Object.fromEntries(page.entries.map((e) => [short(e.teamKey), e.rank]));
  if (cur && !sameRanks(cur.ranks, ranks)) previous.set(board, { ...previous.get(board), [page.page]: cur });
  const pages = newest<PageSnap>(
    { ...snaps.pages, [page.page]: { at: page.fetchedAt, ranks } },
    MAX_PAGES_KEPT,
    (s) => s.at,
  );
  latest.set(newest<BoardSnaps>({ ...all, [board]: { seen: now, pages } }, MAX_BOARDS, (b) => b.seen));
}

/** Movement for the rows of one page, keyed by team. Teams that didn't move are left out. */
export function movesFor(board: string, page: LeaderboardPage): Map<string, Move> {
  const out = new Map<string, Move>();
  const snaps = [...Object.entries(latest.get()[board]?.pages ?? {}), ...Object.entries(previous.get(board) ?? {})]
    .filter(([, s]) => s.at < page.fetchedAt)
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
  if (!snaps.length) return out;
  const pageSeenBefore = snaps.some(([p]) => Number(p) === page.page);
  for (const e of page.entries) {
    const k = short(e.teamKey);
    const before = snaps.find(([, s]) => s.ranks[k] !== undefined)?.[1].ranks[k];
    if (before !== undefined) {
      if (before !== e.rank) out.set(e.teamKey, before - e.rank);
    } else if (pageSeenBefore) out.set(e.teamKey, 'new');
  }
  return out;
}

/** Movement for the rows shown, each measured on the page it's shown from. */
export function boardMoves(
  board: string,
  pages: Record<number, LeaderboardPage>,
  rows: { page: number; entry: Entry }[],
): Map<string, Move> {
  const byPage = new Map<number, Map<string, Move>>();
  const out = new Map<string, Move>();
  for (const { page, entry } of rows) {
    if (!byPage.has(page)) byPage.set(page, pages[page] ? movesFor(board, pages[page]) : new Map());
    const m = byPage.get(page)!.get(entry.teamKey);
    if (m !== undefined) out.set(entry.teamKey, m);
  }
  return out;
}

/** Drops a board's snapshots, once it's final. */
export function forgetBoard(board: string): void {
  previous.delete(board);
  if (latest.get()[board]) {
    const next = { ...latest.get() };
    delete next[board];
    latest.set(next);
  }
}
