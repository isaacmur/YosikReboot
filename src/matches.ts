// Matches rebuilt from a board (D28). Every team's games carry Epic's match ID,
// and teams with the same ID played the same game. In a set lobby (finals,
// heats) every team in the lobby shares every game, so each game's full lobby
// can be shown; in an open session a game only lists the teams on the pages
// you've loaded.

import type { Entry, MatchResult } from '../lib/types';

export interface MatchTeam {
  entry: Entry;
  result: MatchResult;
}

export interface Match {
  id: string;
  endedAt: string;
  /** Best placement first. */
  teams: MatchTeam[];
}

export interface Lobby {
  /** 1-based, best-placed lobby first. */
  n: number;
  teams: number;
  /** Oldest first: Match 1, Match 2, … */
  matches: Match[];
}

const byPlace = (a: MatchTeam, b: MatchTeam) =>
  (a.result.place ?? 999) - (b.result.place ?? 999) || (b.result.points ?? 0) - (a.result.points ?? 0);

/** Every game on these rows, keyed by match ID. */
export function matchesOf(rows: Entry[]): Map<string, Match> {
  const out = new Map<string, Match>();
  for (const entry of rows)
    for (const result of entry.sessions) {
      if (!result.sessionId) continue;
      const m = out.get(result.sessionId) ?? { id: result.sessionId, endedAt: result.endedAt, teams: [] };
      m.teams.push({ entry, result });
      if (result.endedAt > m.endedAt) m.endedAt = result.endedAt;
      out.set(result.sessionId, m);
    }
  for (const m of out.values()) m.teams.sort(byPlace);
  return out;
}

/**
 * True when teams share their games (set lobbies) rather than meeting a team or
 * two from each other lobby (opens): on average a game here holds at least 8 of
 * these teams, or half of them on a small board.
 */
export function isSetLobby(rows: Entry[]): boolean {
  const matches = [...matchesOf(rows).values()];
  if (!matches.length) return false;
  const perGame = matches.reduce((n, m) => n + m.teams.length, 0) / matches.length;
  return perGame >= Math.min(8, rows.length / 2);
}

/**
 * Lobbies: teams that played together, with their games numbered in order.
 * Games that only one of these teams played (opens) belong to no lobby.
 */
export function lobbiesOf(rows: Entry[]): Lobby[] {
  // Union teams that shared a game.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const matches = [...matchesOf(rows).values()].filter((m) => m.teams.length > 1);
  for (const m of matches) {
    const [first, ...rest] = m.teams.map((t) => find(t.entry.teamKey));
    for (const r of rest) if (r !== first) parent.set(r, first!);
  }
  const groups = new Map<string, { best: number; teams: Set<string>; matches: Match[] }>();
  for (const m of matches) {
    const root = find(m.teams[0]!.entry.teamKey);
    const g = groups.get(root) ?? { best: Infinity, teams: new Set<string>(), matches: [] };
    g.matches.push(m);
    for (const t of m.teams) {
      g.teams.add(t.entry.teamKey);
      g.best = Math.min(g.best, t.entry.rank);
    }
    groups.set(root, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.best - b.best)
    .map((g, i) => ({
      n: i + 1,
      teams: g.teams.size,
      matches: g.matches.sort((a, b) => a.endedAt.localeCompare(b.endedAt)),
    }));
}

/** "13:34" */
export function formatAlive(seconds: number | null): string {
  if (seconds === null) return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
