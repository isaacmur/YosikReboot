// SYNTHETIC leaderboard rows for the match tests: set lobbies, where every team
// in a lobby plays every game, and an open session, where each team plays its
// own games. Shaped like normalized entries; not Epic captures.

import type { Entry, MatchResult } from '../../lib/types';

const id = (n: number) => n.toString(16).padStart(32, '0');

function team(rank: number, games: MatchResult[]): Entry {
  const key = id(rank);
  return {
    rank,
    teamKey: key,
    members: [{ id: key, name: `Team${rank}` }],
    points: games.reduce((n, g) => n + (g.points ?? 0), 0),
    matches: games.length,
    victories: games.filter((g) => g.victory).length,
    elims: games.reduce((n, g) => n + g.elims, 0),
    avgPlace: null,
    sessions: games,
  };
}

const game = (sessionId: string, minute: number, place: number): MatchResult => ({
  sessionId,
  endedAt: new Date(Date.UTC(2026, 9, 20, 23, minute)).toISOString(),
  place,
  elims: place % 4,
  points: Math.max(0, 30 - place),
  victory: place === 1,
  timeAlive: 1500 - place * 20,
});

/** `lobbies` lobbies of `teams` teams, each lobby playing `games` games together. */
export function setLobbyBoard(teams: number, games: number, lobbies = 1): Entry[] {
  const rows: Entry[] = [];
  for (let l = 0; l < lobbies; l++)
    for (let t = 0; t < teams; t++) {
      // Places rotate so each game has a different winner.
      const sessions = Array.from({ length: games }, (_, g) =>
        game(`lobby${l}-game${g}`, 20 * (g + 1), ((t + g) % teams) + 1),
      );
      rows.push(team(l * teams + t + 1, sessions));
    }
  return rows;
}

/** `teams` teams that each played `games` games of their own. */
export function openBoard(teams: number, games: number): Entry[] {
  return Array.from({ length: teams }, (_, t) =>
    team(
      t + 1,
      Array.from({ length: games }, (_, g) => game(`t${t}-g${g}`, 20 * (g + 1), ((t * 7 + g * 13) % 50) + 1)),
    ),
  );
}
