// Finding followed players on a board (D10: Epic won't look them up directly).
// Walks the board's pages one at a time through /api/leaderboard in lite mode
// (CDN-cached, no names), stopping once everyone is found. A repeat search starts
// around the pages where they were last found. Results for final boards never
// change, so they're kept in this browser for good; others for 5 min.

import type { Entry, LeaderboardPage, WindowDetail } from '../lib/types';
import { ApiError, apiGet } from './api';
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
const keyOf = (eventId: string, windowId: string, board: string) => `${eventId}|${windowId}|${board}`;

/** Re-renders when saved scans or session checks change. */
export function useScans(): void {
  permanent.use();
  windowChecks.use();
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

/** All kept scans (final ones and recent live ones), most recent session first. */
export function allScans(): BoardScan[] {
  const when = (x: BoardScan) => x.endedAt ?? x.scannedAt;
  return [...Object.values(permanent.get()), ...recent.values()].sort((a, b) => when(b).localeCompare(when(a)));
}

/** True once a session was fully checked for this player (found, or every board read to the end). */
export function isWindowChecked(eventId: string, windowId: string, id: string): boolean {
  return (windowChecks.get()[`${eventId}|${windowId}`] ?? []).includes(id);
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

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Aborted', 'AbortError'))));
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
  const want = new Set(ids);
  const found: Record<string, FoundRow> = {};
  const read = new Set<number>();
  let totalPages = 1;
  // The first page read says how many there are; then read in scanOrder.
  let queue = [o.hints?.[0] ?? 0];
  while (queue.length) {
    const page = queue.shift()!;
    if (o.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const q = new URLSearchParams({ event: eventId, window: windowId, board, page: String(page), lite: '1' });
    let data: LeaderboardPage;
    try {
      data = await apiGet<LeaderboardPage>(`/api/leaderboard?${q}`);
    } catch (err) {
      // Rate limited or Epic hiccup: wait once, then try the page again.
      if (!(err instanceof ApiError) || err.status < 500) throw err;
      await sleep(3000, o.signal);
      data = await apiGet<LeaderboardPage>(`/api/leaderboard?${q}`);
    }
    read.add(page);
    if (read.size === 1) {
      totalPages = Math.min(data.totalPages, 100);
      queue = scanOrder(totalPages, o.hints).filter((p) => !read.has(p));
    }
    for (const e of data.entries) for (const m of e.members) if (want.has(m.id)) found[m.id] = toRow(e);
    o.onProgress?.(read.size, totalPages);
    if (Object.keys(found).length === want.size) break;
  }
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
    const scan = await scanBoard(eventId, windowId, b.id, remaining, { ...o, boardLabel: b.label });
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
