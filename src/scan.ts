// Finding followed players on a board (D10: Epic won't look them up directly).
// Reads the board's pages through /api/leaderboard in lite mode (CDN-cached, no
// names), a few at a time and kept in memory (D26), stopping once everyone is
// found. A repeat search starts around the pages where they were last found.
// Results for final boards never change, so they're kept in this browser for
// good; others for 5 min.

import type { Entry, PayoutTier, WindowDetail } from '../lib/types';
import { apiGet } from './api';
import { CONCURRENCY, litePage, runPool } from './boardIndex';
import { createStore } from './store';

export interface FoundRow {
  rank: number;
  points: number;
  matches: number;
  victories: number;
  elims: number;
  avgPlace: number | null;
  memberIds: string[];
}

export interface BoardScan {
  eventId: string;
  windowId: string;
  board: string;
  boardLabel: string;
  /** Every page was read, so anyone missing isn't in the top 10,000. */
  complete: boolean;
  pagesScanned: number;
  totalPages: number;
  searchedFor: string[];
  found: Record<string, FoundRow>;
  scannedAt: string;
  final: boolean;
  /** For lists of results: "Solo Ranked Cup · Event 8" and when the session ended. */
  title?: string;
  endedAt?: string;
  /** The board's payout tiers, so prizes can be worked out later (scans saved before Phase 4 lack them). */
  payouts?: PayoutTier[];
}

export const LIVE_TTL_MS = 5 * 60_000;
const permanent = createStore<Record<string, BoardScan>>(
  'yr.scans.v1',
  (r) => (r && typeof r === 'object' ? (r as Record<string, BoardScan>) : {}),
  {},
);
const recent = new Map<string, BoardScan>();
/** Sessions whose every scored board was read (or the player found) for these IDs. */
const windowChecks = createStore<Record<string, string[]>>(
  'yr.windowChecks.v1',
  (r) => (r && typeof r === 'object' ? (r as Record<string, string[]>) : {}),
  {},
);
/** Sessions a sync showed you didn't play (D30), so they're left out of the list to check. */
const notPlayed = createStore<Record<string, string[]>>(
  'yr.notPlayed.v3',
  (r) => (r && typeof r === 'object' ? (r as Record<string, string[]>) : {}),
  {},
);

// The first two versions of Sync with Epic marked sessions as not played on
// weaker evidence than Epic's history: `player.teams`, which isn't a history,
// then boards filtered to just you (D30). Those marks are undone once, so the
// history-based sync asks about those sessions again.
for (const key of ['yr.notPlayed.v1', 'yr.notPlayed.v2'])
  try {
    const old = localStorage.getItem(key);
    if (old) {
      const marks = JSON.parse(old) as Record<string, string[]>;
      const checks = { ...windowChecks.get() };
      for (const [session, ids] of Object.entries(marks)) {
        const kept = (checks[session] ?? []).filter((id) => !ids.includes(id));
        if (kept.length) checks[session] = kept;
        else delete checks[session];
      }
      windowChecks.set(checks);
      localStorage.removeItem(key);
    }
  } catch {
    // No storage: nothing was kept.
  }
const keyOf = (eventId: string, windowId: string, board: string) => `${eventId}|${windowId}|${board}`;

/** Re-renders when saved scans or session checks change. */
export function useScans(): void {
  permanent.use();
  windowChecks.use();
  notPlayed.use();
}

/** Cached scan that already answers for all `ids`, if any. */
export function cachedScan(eventId: string, windowId: string, board: string, ids: string[]): BoardScan | undefined {
  const key = keyOf(eventId, windowId, board);
  const hit = permanent.get()[key] ?? recent.get(key);
  if (!hit) return undefined;
  if (!hit.final && Date.now() - Date.parse(hit.scannedAt) > LIVE_TTL_MS) return undefined;
  return hit.complete || ids.every((id) => hit.searchedFor.includes(id)) ? hit : undefined;
}

/** The latest scan of a board, however old, for showing where follows were last found. */
export function lastScan(eventId: string, windowId: string, board: string): BoardScan | undefined {
  const key = keyOf(eventId, windowId, board);
  return permanent.get()[key] ?? recent.get(key);
}

/** Adds payout tiers to a kept scan saved without them. */
export function setScanPayouts(eventId: string, windowId: string, board: string, payouts: PayoutTier[]): void {
  const key = keyOf(eventId, windowId, board);
  const hit = permanent.get()[key];
  if (hit && !hit.payouts) permanent.set({ ...permanent.get(), [key]: { ...hit, payouts } });
  const live = recent.get(key);
  if (live && !live.payouts) recent.set(key, { ...live, payouts });
}

/** All kept scans (final ones and recent live ones), most recent session first. */
export function allScans(): BoardScan[] {
  const when = (x: BoardScan) => x.endedAt ?? x.scannedAt;
  return [...Object.values(permanent.get()), ...recent.values()].sort((a, b) => when(b).localeCompare(when(a)));
}

/** True once a session was fully checked for this player (found, or every board read to the end). */
export function isWindowChecked(eventId: string, windowId: string, id: string): boolean {
  return (windowChecks.get()[`${eventId}|${windowId}`] ?? []).includes(id);
}

/** Marks a session as fully checked for `id`, so it leaves the list of sessions to check. */
export function markWindowChecked(eventId: string, windowId: string, id: string): void {
  const key = `${eventId}|${windowId}`;
  const ids = windowChecks.get()[key] ?? [];
  if (!ids.includes(id)) windowChecks.set({ ...windowChecks.get(), [key]: [...ids, id] });
}

/** Marks a session as one you didn't play, which also counts as checked. */
export function markNotPlayed(eventId: string, windowId: string, id: string): void {
  markWindowChecked(eventId, windowId, id);
  const key = `${eventId}|${windowId}`;
  const ids = notPlayed.get()[key] ?? [];
  if (!ids.includes(id)) notPlayed.set({ ...notPlayed.get(), [key]: [...ids, id] });
}

export function didNotPlay(eventId: string, windowId: string, id: string): boolean {
  return (notPlayed.get()[`${eventId}|${windowId}`] ?? []).includes(id);
}

/**
 * Keeps a row read straight from Epic (Sync with Epic, D30) like a search result
 * on a final board, alongside whatever earlier searches of that board found.
 */
export function recordResult(
  x: Pick<BoardScan, 'eventId' | 'windowId' | 'board' | 'boardLabel' | 'title' | 'endedAt' | 'payouts'>,
  id: string,
  entry: Entry,
): void {
  const key = keyOf(x.eventId, x.windowId, x.board);
  const prev = permanent.get()[key];
  const scan: BoardScan = {
    complete: false,
    pagesScanned: 0,
    totalPages: 0,
    ...prev,
    ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)),
    eventId: x.eventId,
    windowId: x.windowId,
    board: x.board,
    boardLabel: x.boardLabel,
    searchedFor: [...new Set([...(prev?.searchedFor ?? []), id])],
    found: { ...prev?.found, [id]: toRow(entry) },
    scannedAt: new Date().toISOString(),
    final: true,
  };
  permanent.set({ ...permanent.get(), [key]: scan });
}

const toRow = (e: Entry): FoundRow => ({
  rank: e.rank,
  points: e.points,
  matches: e.matches,
  victories: e.victories,
  elims: e.elims,
  avgPlace: e.avgPlace,
  memberIds: e.members.map((m) => m.id),
});

/**
 * Pages in reading order: each hinted page and its neighbours out to `reach`
 * (nearest first), then the rest from the top.
 */
export function scanOrder(totalPages: number, hints: number[] = [], reach = 2): number[] {
  const order = new Set<number>();
  const add = (p: number) => p >= 0 && p < totalPages && order.add(p);
  for (const h of hints) for (let d = 0; d <= reach; d++) [h - d, h + d].forEach(add);
  for (let p = 0; p < totalPages; p++) add(p);
  return [...order];
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** Pages to read first, e.g. where the players were last found. */
  hints?: number[];
  onProgress?: (pagesDone: number, totalPages: number) => void;
  /** True if the board will never change (final), so the result is kept for good. */
  final: boolean;
  boardLabel: string;
  title?: string;
  endedAt?: string;
  payouts?: PayoutTier[];
}

export interface BoardSearch {
  found: Record<string, FoundRow>;
  /** Pages read, so `complete` can be told from a stopped search. */
  read: Set<number>;
  totalPages: number;
}

/**
 * Reads a board until every one of `ids` is found or every page is read, and
 * keeps nothing but the pages in memory (D26). `scanBoard` saves the result.
 */
export async function searchBoard(
  eventId: string,
  windowId: string,
  board: string,
  ids: string[],
  o: Pick<ScanOptions, 'signal' | 'hints' | 'onProgress' | 'final'>,
): Promise<BoardSearch> {
  const want = new Set(ids);
  const found: Record<string, FoundRow> = {};
  const read = new Set<number>();
  const q = { event: eventId, window: windowId, board };
  const take = (page: number, entries: Entry[]) => {
    read.add(page);
    for (const e of entries) for (const m of e.members) if (want.has(m.id)) found[m.id] = toRow(e);
  };
  const done = () => o.signal?.aborted || Object.keys(found).length === want.size;
  // The first page read says how many there are; then the rest in scanOrder, a few at a time.
  const first = o.hints?.[0] ?? 0;
  const head = await litePage({ ...q, page: first }, { final: o.final, signal: o.signal });
  const totalPages = Math.min(head.totalPages, 100);
  take(first, head.entries);
  o.onProgress?.(read.size, totalPages);
  const rest = scanOrder(totalPages, o.hints).filter((p) => p !== first);
  await runPool(
    rest,
    CONCURRENCY,
    async (page) => {
      const data = await litePage({ ...q, page }, { final: o.final, signal: o.signal });
      take(page, data.entries);
      o.onProgress?.(read.size, totalPages);
    },
    done,
  );
  if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return { found, read, totalPages };
}

export async function scanBoard(
  eventId: string,
  windowId: string,
  board: string,
  ids: string[],
  o: ScanOptions,
): Promise<BoardScan> {
  const cached = cachedScan(eventId, windowId, board, ids);
  if (cached) return cached;
  const { found, read, totalPages } = await searchBoard(eventId, windowId, board, ids, o);
  const want = new Set(ids);
  const scan: BoardScan = {
    eventId,
    windowId,
    board,
    boardLabel: o.boardLabel,
    complete: [...Array(totalPages).keys()].every((p) => read.has(p)),
    pagesScanned: read.size,
    totalPages,
    searchedFor: [...want],
    found,
    scannedAt: new Date().toISOString(),
    final: o.final,
    ...(o.title ? { title: o.title } : {}),
    ...(o.endedAt ? { endedAt: o.endedAt } : {}),
    ...(o.payouts ? { payouts: o.payouts } : {}),
  };
  const key = keyOf(eventId, windowId, board);
  if (o.final) permanent.set({ ...permanent.get(), [key]: scan });
  else recent.set(key, scan);
  return scan;
}

/** Scans every scored board of a session (all Ranked Cup tiers) until everyone is found. */
export async function scanWindow(
  eventId: string,
  windowId: string,
  ids: string[],
  o: Omit<ScanOptions, 'boardLabel'> & { onBoard?: (label: string) => void },
): Promise<BoardScan[]> {
  const detail = await apiGet<WindowDetail>(`/api/window?${new URLSearchParams({ event: eventId, window: windowId })}`);
  const boards = detail.boards.filter((b) => b.hasPoints && !b.computed);
  const scans: BoardScan[] = [];
  let remaining = ids;
  // Top tier first: that's where followed competitive players usually are.
  for (const b of [...boards].reverse()) {
    if (!remaining.length) break;
    o.onBoard?.(b.label);
    const scan = await scanBoard(eventId, windowId, b.id, remaining, {
      ...o,
      boardLabel: b.label,
      payouts: b.payouts,
    });
    scans.push(scan);
    remaining = remaining.filter((id) => !scan.found[id]);
  }
  // Only a finished pass counts as checked; a stopped one throws before this.
  if (o.final) {
    const key = `${eventId}|${windowId}`;
    windowChecks.set({ ...windowChecks.get(), [key]: [...new Set([...(windowChecks.get()[key] ?? []), ...ids])] });
  }
  return scans;
}
