// Matches rebuilt from boards (D28): synthetic set lobbies and opens from
// test/helpers/boards.ts, and a real open cup from the capture.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeEntries } from '../lib/epic/leaderboard';
import { formatAlive, isSetLobby, lobbiesOf, matchesOf } from '../src/matches';
import { openBoard, setLobbyBoard } from './helpers/boards';

describe('matches', () => {
  it('groups every team in a game, best placement first', () => {
    const rows = setLobbyBoard(20, 3);
    const matches = matchesOf(rows);
    expect(matches.size).toBe(3);
    const first = matches.get('lobby0-game0')!;
    expect(first.teams).toHaveLength(20);
    expect(first.teams.map((t) => t.result.place)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('tells set lobbies from open sessions', () => {
    expect(isSetLobby(setLobbyBoard(20, 6))).toBe(true);
    expect(isSetLobby(setLobbyBoard(4, 2))).toBe(true);
    expect(isSetLobby(openBoard(100, 6))).toBe(false);
    expect(isSetLobby([])).toBe(false);
    // A real open cup's top 100: some shared lobbies, but not set lobbies.
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures/epic/first/leaderboard-final-p0.json'), 'utf8'));
    expect(isSetLobby(normalizeEntries(raw, []))).toBe(false);
  });

  it('splits heats into lobbies and numbers their games in order', () => {
    const lobbies = lobbiesOf(setLobbyBoard(10, 4, 3));
    expect(lobbies.map((l) => [l.n, l.teams, l.matches.length])).toEqual([
      [1, 10, 4],
      [2, 10, 4],
      [3, 10, 4],
    ]);
    const ends = lobbies[0]!.matches.map((m) => m.endedAt);
    expect(ends).toEqual([...ends].sort());
    // Open sessions: a team's own games make no lobby.
    expect(lobbiesOf(openBoard(30, 4))).toEqual([]);
  });

  it('formats time alive', () => {
    expect(formatAlive(814)).toBe('13:34');
    expect(formatAlive(779.6)).toBe('13:00');
    expect(formatAlive(null)).toBe('—');
  });
});
