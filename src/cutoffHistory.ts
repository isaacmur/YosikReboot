// Cutoff history (F28): the points each qualifying or paid line took in a
// finished session. Reading one costs the session's rules (/api/window) and
// one lite page per line; final standings never change, so the answer is kept
// in this browser for good (D25).

import { windowState } from '../lib/status';
import type { EventWindow, LeaderboardPage, WindowDetail } from '../lib/types';
import { apiGet, apiGetCached } from './api';
import { cutoffTitle, entryAtRank, pageOfRank } from './board';
import { createStore } from './store';

export interface CutoffPoints {
  /** Same line in every session of an event: kind, basis and threshold. */
  key: string;
  /** "Top 20 · Qualify" */
  title: string;
  label: string;
  rank: number;
  /** Points of the team on the line; null when fewer teams finished than the line allows. */
  points: number | null;
}

export interface SessionCutoffs {
  board: string;
  boardLabel: string;
  lines: CutoffPoints[];
}

const store = createStore<Record<string, SessionCutoffs>>(
  'yr.cutoffHistory.v1',
  (r) => (r && typeof r === 'object' ? (r as Record<string, SessionCutoffs>) : {}),
  {},
);
const keyOf = (eventId: string, windowId: string) => `${eventId}|${windowId}`;

/** Re-renders when a session's cutoffs are saved. */
export const useCutoffHistory = store.use;

export const savedCutoffs = (eventId: string, windowId: string): SessionCutoffs | undefined =>
  store.get()[keyOf(eventId, windowId)];

/** Finished sessions, oldest first: the only ones with settled cutoffs. */
export const finishedSessions = (windows: EventWindow[], now = new Date()) =>
  windows.filter((w) => windowState(w, now) === 'final').sort((a, b) => a.end.localeCompare(b.end));

/**
 * Reads a finished session's qualifying and paid rank lines on its main board
 * (Ranked Cups have only item tiers, so none). Points lines aren't read: what
 * they take is in their name.
 */
export async function loadCutoffs(eventId: string, w: EventWindow): Promise<SessionCutoffs> {
  const saved = savedCutoffs(eventId, w.id);
  if (saved) return saved;
  const detail = await apiGetCached<WindowDetail>(
    `/api/window?${new URLSearchParams({ event: eventId, window: w.id })}`,
    3_600_000,
  );
  const board = detail.boards.find((b) => b.id === detail.defaultBoard) ?? detail.boards[0]!;
  const lines = board.cutoffs.filter((c) => c.kind !== 'item' && c.basis === 'rank');
  const pages: LeaderboardPage[] = [];
  for (const page of new Set(lines.map((c) => pageOfRank(c.threshold)))) {
    const q = new URLSearchParams({ event: eventId, window: w.id, board: board.id, page: String(page), lite: '1' });
    pages.push(await apiGet<LeaderboardPage>(`/api/leaderboard?${q}`));
  }
  const result: SessionCutoffs = {
    board: board.id,
    boardLabel: board.label,
    lines: lines.map((c) => ({
      key: `${c.kind}|${c.basis}|${c.threshold}`,
      title: `${cutoffTitle(c)} · ${c.kind === 'cash' ? 'Paid' : 'Qualify'}`,
      label: c.label,
      rank: c.threshold,
      points: entryAtRank(c.threshold, pages)?.points ?? null,
    })),
  };
  store.set({ ...store.get(), [keyOf(eventId, w.id)]: result });
  return result;
}
