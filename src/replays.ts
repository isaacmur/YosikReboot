// Replay stats in the browser (D31). Each game's replay is read once through
// /api/replay and kept here for good, trimmed to the players asked about,
// because Epic deletes replays after one to two weeks. A tournament's numbers
// per player are added up from its games.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LeaderboardPage, ReplayElim, ReplayPlayerStats, ReplaySummary } from '../lib/types';
import { ApiError, apiGet, apiGetCached } from './api';
import { pageOfRank } from './board';
import { runPool } from './boardIndex';
import type { BoardScan, FoundRow } from './scan';
import { createStore } from './store';

interface Kept {
  at: string;
  /** Players the elims and stats were kept for. */
  kept: string[];
  gone?: boolean;
  summary?: Omit<ReplaySummary, 'elims' | 'stats'> & {
    elims: ReplayElim[];
    stats: ReplayPlayerStats[];
    /** Stats events in the whole replay, and how many named an account. */
    statsEvents: number;
    namedStats: number;
  };
}

const store = createStore<Record<string, Kept>>(
  'yr.replays.v1',
  (r) => (r && typeof r === 'object' ? (r as Record<string, Kept>) : {}),
  {},
);
export const useReplayStore = store.use;

const needs = (id: string, players: string[]) => {
  const k = store.get()[id];
  return !k || (!k.gone && players.some((p) => !k.kept.includes(p)));
};

/** Reads the replays not yet kept for these players, three at a time. Throws the first failure other than "gone". */
export async function readReplays(matchIds: string[], players: string[], onProgress?: (done: number) => void) {
  const todo = [...new Set(matchIds)].filter((id) => id && needs(id, players));
  let done = 0;
  let failure: unknown;
  await runPool(todo, 3, async (id) => {
    try {
      const s = await apiGet<ReplaySummary>(`/api/replay?match=${encodeURIComponent(id)}`);
      const prev = store.get()[id];
      const kept = [...new Set([...(prev?.kept ?? []), ...players])];
      const involves = (x: string | null) => x !== null && kept.includes(x);
      store.set({
        ...store.get(),
        [id]: {
          at: new Date().toISOString(),
          kept,
          summary: {
            ...s,
            elims: s.elims.filter((e) => involves(e.eliminator) || involves(e.eliminated)),
            stats: s.stats.filter((x) => involves(x.player)),
            statsEvents: s.stats.length,
            namedStats: s.stats.filter((x) => x.player).length,
          },
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'replay_gone')
        store.set({ ...store.get(), [id]: { at: new Date().toISOString(), kept: [], gone: true } });
      else failure ??= err;
    } finally {
      onProgress?.(++done);
    }
  });
  if (failure) throw failure;
}

export interface PlayerReplayStats {
  eliminations: number;
  knocks: number;
  knocked: number;
  deaths: number;
  /** Games whose replay had this player's match stats. */
  statsGames: number;
  damageToPlayers: number;
  damageTaken: number;
  materialsGathered: number;
  materialsUsed: number;
  damageToStructures: number;
  revives: number;
  distance: number;
  /** Average over the games with stats. */
  accuracy: number | null;
}

export interface ReplayTotals {
  /** Games whose replay was read, and those Epic no longer has. */
  read: number;
  gone: number;
  byPlayer: Map<string, PlayerReplayStats>;
  /** Event kinds across the replays read, for when stats are missing. */
  events: Record<string, number>;
  notes: string[];
  statsEvents: number;
  namedStats: number;
}

/** A tournament's replay numbers per player, from the replays kept for its games. */
export function replayTotals(matchIds: string[], players: string[], kept = store.get()): ReplayTotals {
  const byPlayer = new Map<string, PlayerReplayStats>(
    players.map((p) => [
      p,
      {
        eliminations: 0,
        knocks: 0,
        knocked: 0,
        deaths: 0,
        statsGames: 0,
        damageToPlayers: 0,
        damageTaken: 0,
        materialsGathered: 0,
        materialsUsed: 0,
        damageToStructures: 0,
        revives: 0,
        distance: 0,
        accuracy: null,
      },
    ]),
  );
  const accuracy = new Map<string, number[]>();
  const t: ReplayTotals = { read: 0, gone: 0, byPlayer, events: {}, notes: [], statsEvents: 0, namedStats: 0 };
  for (const id of new Set(matchIds)) {
    const k = kept[id];
    if (k?.gone) t.gone++;
    if (!k?.summary) continue;
    t.read++;
    const s = k.summary;
    for (const [kind, n] of Object.entries(s.events)) t.events[kind] = (t.events[kind] ?? 0) + n;
    for (const n of s.notes) if (!t.notes.includes(n)) t.notes.push(n);
    t.statsEvents += s.statsEvents;
    t.namedStats += s.namedStats;
    for (const e of s.elims) {
      const by = e.eliminator && byPlayer.get(e.eliminator);
      const on = e.eliminated && byPlayer.get(e.eliminated);
      if (by) by[e.knocked ? 'knocks' : 'eliminations']++;
      if (on) on[e.knocked ? 'knocked' : 'deaths']++;
    }
    for (const x of s.stats) {
      const p = x.player && byPlayer.get(x.player);
      if (!p) continue;
      p.statsGames++;
      p.damageToPlayers += x.damageToPlayers;
      p.damageTaken += x.damageTaken;
      p.materialsGathered += x.materialsGathered;
      p.materialsUsed += x.materialsUsed;
      p.damageToStructures += x.damageToStructures;
      p.revives += x.revives;
      p.distance += x.distance;
      accuracy.set(x.player!, [...(accuracy.get(x.player!) ?? []), x.accuracy]);
    }
  }
  for (const [p, list] of accuracy) byPlayer.get(p)!.accuracy = list.reduce((a, b) => a + b, 0) / list.length;
  return t;
}

/** Reads a tournament's replays when shown (once each, kept for good) and totals them per player. */
export function useReplayTotals(matchIds: string[], players: string[]) {
  const kept = useReplayStore();
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<string>();
  const ids = matchIds.join(',');
  const who = players.join(',');
  useEffect(() => {
    const list = ids ? ids.split(',') : [];
    const team = who.split(',');
    const todo = list.filter((id) => needs(id, team));
    if (!todo.length) return;
    let live = true;
    setProgress({ done: 0, total: todo.length });
    setError(undefined);
    readReplays(todo, team, (done) => live && setProgress({ done, total: todo.length }))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setProgress(undefined));
    return () => {
      live = false;
    };
  }, [ids, who]);
  const totals = useMemo(() => replayTotals(ids ? ids.split(',') : [], who.split(','), kept), [ids, who, kept]);
  return { totals, progress, error };
}

/** Results whose games' replays were all read or found gone, keyed "event|window|board". */
const readResults = createStore<Record<string, string>>(
  'yr.replayResults.v1',
  (r) => (r && typeof r === 'object' ? (r as Record<string, string>) : {}),
  {},
);

const RECENT_MS = 14 * 86_400_000;

/**
 * On Me: reads the replays of your results from the last two weeks, while Epic
 * still has them, a few results per visit, so they're kept before they're gone.
 */
export function useRecentReplays(results: { x: BoardScan; row: FoundRow }[], me: string): void {
  const due = results
    .filter(
      ({ x }) =>
        x.endedAt &&
        Date.now() - Date.parse(x.endedAt) < RECENT_MS &&
        !readResults.get()[`${x.eventId}|${x.windowId}|${x.board}`],
    )
    .slice(0, 3);
  const key = due.map(({ x }) => `${x.eventId}|${x.windowId}|${x.board}`).join(',');
  const dueRef = useRef(due);
  dueRef.current = due;
  useEffect(() => {
    if (!key) return;
    let live = true;
    void (async () => {
      for (const { x, row } of dueRef.current) {
        if (!live) return;
        try {
          const q = new URLSearchParams({
            event: x.eventId,
            window: x.windowId,
            board: x.board,
            page: String(pageOfRank(row.rank)),
          });
          const page = await apiGetCached<LeaderboardPage>(`/api/leaderboard?${q}`, 3_600_000);
          const entry = page.entries.find((e) => e.members.some((m) => m.id === me));
          if (!entry) continue;
          await readReplays(
            entry.sessions.map((s) => s.sessionId),
            entry.members.map((m) => m.id),
          );
          readResults.set({
            ...readResults.get(),
            [`${x.eventId}|${x.windowId}|${x.board}`]: new Date().toISOString(),
          });
        } catch {
          // Try again on the next visit.
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [key, me]);
}
