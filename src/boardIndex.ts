// Reading many board pages quickly (D26): a few at a time, retrying when Epic
// pushes back, and keeping each lite page in memory so a board read once answers
// later searches (other follows, Me, a name) without reading it again. Final
// boards are kept for the visit, live ones for a minute, the last few boards only.

import type { LeaderboardPage } from '../lib/types';
import { ApiError, apiGet } from './api';

/** Pages read at once. The API spaces its Epic calls, and the CDN answers repeats. */
export const CONCURRENCY = 4;
const RETRY_MS = [2000, 5000];
const LIVE_MS = 60_000;
const KEEP_BOARDS = 4;

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Aborted', 'AbortError'))));
  });

export interface PageQuery {
  event: string;
  window: string;
  board: string;
  page: number;
  lite?: boolean;
}

const pathOf = (q: PageQuery) =>
  `/api/leaderboard?${new URLSearchParams({
    event: q.event,
    window: q.window,
    board: q.board,
    page: String(q.page),
    ...(q.lite ? { lite: '1' } : {}),
  })}`;

/** One page, waiting and retrying twice when Epic or the API is overloaded (5xx, including rate limiting). */
export async function readPage(q: PageQuery, signal?: AbortSignal): Promise<LeaderboardPage> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await apiGet<LeaderboardPage>(pathOf(q));
    } catch (err) {
      const retry = RETRY_MS[attempt];
      if (!(err instanceof ApiError) || err.status < 500 || retry === undefined) throw err;
      await sleep(retry, signal);
    }
  }
}

/**
 * Runs `job` over `items` in order, `limit` at a time, until every item is done
 * or `stop()` says so. The first failure stops the rest and is thrown.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  job: (item: T) => Promise<void>,
  stop: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < items.length && !failed && !stop()) {
      const item = items[next++]!;
      try {
        await job(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// --- The index of lite pages

interface Kept {
  page: LeaderboardPage;
  at: number;
}
const boards = new Map<string, Map<number, Kept>>();

const keyOf = (q: Omit<PageQuery, 'page' | 'lite'>) => `${q.event}|${q.window}|${q.board}`;

/** A lite page from the index, or read and indexed. */
export async function litePage(
  q: Omit<PageQuery, 'lite'>,
  o: { final: boolean; signal?: AbortSignal; now?: () => number },
): Promise<LeaderboardPage> {
  const now = o.now ?? Date.now;
  const key = keyOf(q);
  const hit = boards.get(key)?.get(q.page);
  if (hit && (o.final || now() - hit.at < LIVE_MS)) return hit.page;
  const page = await readPage({ ...q, lite: true }, o.signal);
  indexPage(q, page, now());
  return page;
}

function indexPage(q: Omit<PageQuery, 'page' | 'lite'>, page: LeaderboardPage, at = Date.now()): void {
  const key = keyOf(q);
  const pages = boards.get(key) ?? new Map<number, Kept>();
  // Most recently used last, so the oldest board goes first.
  boards.delete(key);
  boards.set(key, pages);
  pages.set(page.page, { page, at });
  while (boards.size > KEEP_BOARDS) boards.delete(boards.keys().next().value!);
}

/** How many of a board's pages the index holds. */
export function indexedPages(q: Omit<PageQuery, 'page' | 'lite'>): number {
  return boards.get(keyOf(q))?.size ?? 0;
}

/** For tests. */
export function clearIndex(): void {
  boards.clear();
}
