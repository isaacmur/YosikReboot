// Replay stats in the browser (D31): read once, trimmed to the players asked
// about, kept when gone, and added up per player across a tournament's games.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplaySummary } from '../lib/types';
import { readReplays, replayTotals } from '../src/replays';

const ME = 'a'.repeat(32);
const MATE = 'b'.repeat(32);
const FOE = 'c'.repeat(32);
const stats = (player: string | null, damage: number, accuracy: number) => ({
  player,
  accuracy,
  assists: 0,
  eliminations: 0,
  damageToPlayers: damage,
  damageTaken: 100,
  damageToStructures: 0,
  materialsGathered: 500,
  materialsUsed: 300,
  revives: 0,
  distance: 0,
});
const replay = (matchId: string): ReplaySummary => ({
  matchId,
  lengthMs: 1_200_000,
  live: false,
  events: { playerElim: 4, AthenaMatchStats: 3 },
  elims: [
    { at: 1, eliminated: FOE, eliminator: ME, knocked: true },
    { at: 2, eliminated: FOE, eliminator: ME, knocked: false },
    { at: 3, eliminated: MATE, eliminator: FOE, knocked: false },
    { at: 4, eliminated: 'd'.repeat(32), eliminator: FOE, knocked: false },
  ],
  stats: [stats(ME, 400, 0.2), stats(MATE, 150, 0.1), stats(FOE, 900, 0.3)],
  notes: [],
});

afterEach(() => vi.unstubAllGlobals());

describe('replay stats in the browser', () => {
  it('reads each replay once, keeps only your team, and adds it up per player', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const match = new URL(url, 'https://app.test').searchParams.get('match')!;
      asked.push(match);
      if (match === 'gone1') return Response.json({ error: { code: 'replay_gone', message: 'gone' } }, { status: 404 });
      return Response.json(replay(match));
    });
    await readReplays(['m1', 'm2', 'gone1'], [ME, MATE]);
    await readReplays(['m1', 'm2', 'gone1'], [ME, MATE]);
    expect(asked.sort()).toEqual(['gone1', 'm1', 'm2']);

    const t = replayTotals(['m1', 'm2', 'gone1'], [ME, MATE]);
    expect(t).toMatchObject({ read: 2, gone: 1, statsEvents: 6, namedStats: 6 });
    expect(t.byPlayer.get(ME)).toMatchObject({
      eliminations: 2,
      knocks: 2,
      deaths: 0,
      damageToPlayers: 800,
      statsGames: 2,
    });
    expect(t.byPlayer.get(ME)!.accuracy).toBeCloseTo(0.2);
    expect(t.byPlayer.get(MATE)).toMatchObject({ eliminations: 0, deaths: 2, damageToPlayers: 300 });
    expect(t.events).toEqual({ playerElim: 8, AthenaMatchStats: 6 });
  });

  it('reads a replay again for players it was trimmed without', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => (calls++, Response.json(replay('m3'))));
    await readReplays(['m3'], [ME]);
    expect(replayTotals(['m3'], [FOE]).byPlayer.get(FOE)!.statsGames).toBe(0);
    await readReplays(['m3'], [FOE]);
    expect(calls).toBe(2);
    expect(replayTotals(['m3'], [ME, FOE]).byPlayer.get(FOE)).toMatchObject({ statsGames: 1, damageToPlayers: 900 });
  });
});
