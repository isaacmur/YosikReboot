// Placement after each game (D29): where a team stood on the whole board after
// its 1st, 2nd, 3rd… game, for qualified rounds, finals and Performance
// Evaluations. Every team's games are read from the board's lite pages (each
// game's points), and after game k each team counts the points of its first k
// games. In a set lobby that's the board after each match; elsewhere it's where
// a team would stand if everyone had played as many games.

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventInfo, EventWindow } from '../lib/types';
import { CONCURRENCY, litePage, runPool } from './boardIndex';

/** Sessions that show placement after each game instead of points per game. */
export const showsPlacement = (event: Pick<EventInfo, 'type'>, w: Pick<EventWindow, 'stage'>) =>
  w.stage !== 'open' || event.type === 'PERF_EVAL';

const cumulative = (games: number[], k: number) => games.slice(0, k).reduce((a, b) => a + b, 0);

/**
 * From every team's game points (oldest first), a function giving any team's
 * rank after each of its games. Ties share the better rank.
 */
export function rankHistory(teams: number[][]): (games: number[]) => number[] {
  const most = Math.max(0, ...teams.map((t) => t.length));
  // After game k: every team's running total, highest first.
  const totals = Array.from({ length: most }, (_, i) => teams.map((t) => cumulative(t, i + 1)).sort((a, b) => b - a));
  /** How many totals beat `p` (binary search on the sorted list). */
  const ahead = (sorted: number[], p: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! > p) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return (games) => games.slice(0, most).map((_, i) => 1 + ahead(totals[i]!, cumulative(games, i + 1)));
}

export interface Placements {
  /** This session shows placement after each game. */
  enabled: boolean;
  /** Each game's rank, once the board is read. */
  after?: (games: number[]) => number[];
  teams?: number;
  done: number;
  total: number;
  reading: boolean;
  error?: string;
  /** Reads the board if it hasn't been (or, live, not lately); `retry` after a failure. */
  ensure: (retry?: boolean) => void;
}

const LIVE_MS = 2 * 60_000;

export const PlacementContext = createContext<Placements | undefined>(undefined);

/** Reads a board's every page (lite, four at a time, D26) the first time a row asks. */
export function usePlacements(o: {
  eventId: string;
  windowId: string;
  board: string;
  final: boolean;
  enabled: boolean;
}): Placements {
  const [s, setS] = useState<Omit<Placements, 'enabled' | 'ensure'>>({ done: 0, total: 0, reading: false });
  const readAt = useRef(0);
  const failed = useRef(false);
  const running = useRef(false);
  const ctl = useRef<AbortController>(undefined);
  const latest = useRef(o);
  latest.current = o;
  useEffect(() => () => ctl.current?.abort(), []);

  const ensure = useCallback((retry = false) => {
    const { eventId, windowId, board, final, enabled } = latest.current;
    if (!enabled || running.current || (failed.current && !retry)) return;
    if (readAt.current && (final || Date.now() - readAt.current < LIVE_MS)) return;
    running.current = true;
    failed.current = false;
    const mine = new AbortController();
    ctl.current = mine;
    setS((p) => ({ ...p, reading: true, error: undefined }));
    const q = { event: eventId, window: windowId, board };
    const games = new Map<string, number[] | undefined>();
    const take = (entries: { teamKey: string; gamePoints?: number[] }[]) => {
      for (const e of entries) games.set(e.teamKey, e.gamePoints);
    };
    void (async () => {
      try {
        const head = await litePage({ ...q, page: 0 }, { final, signal: mine.signal });
        take(head.entries);
        const total = Math.min(head.totalPages, 100);
        let done = 1;
        setS((p) => ({ ...p, done, total }));
        const rest = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1);
        await runPool(rest, CONCURRENCY, async (page) => {
          take((await litePage({ ...q, page }, { final, signal: mine.signal })).entries);
          if (!mine.signal.aborted) setS((p) => ({ ...p, done: ++done }));
        });
        const teams = [...games.values()];
        if (teams.some((t) => !t)) throw new Error("This board's games have no points to rank by.");
        readAt.current = Date.now();
        setS({ after: rankHistory(teams as number[][]), teams: teams.length, done, total, reading: false });
      } catch (err) {
        if (mine.signal.aborted) return;
        failed.current = true;
        setS((p) => ({ ...p, reading: false, error: (err as Error).message || 'Reading the board failed' }));
      } finally {
        running.current = false;
      }
    })();
  }, []);

  // One value per change, so rows don't re-render with the board's every-second clock.
  return useMemo(() => ({ ...s, enabled: o.enabled, ensure }), [s, o.enabled, ensure]);
}
