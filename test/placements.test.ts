// Placement after each game (D29).

import { describe, expect, it } from 'vitest';
import { rankHistory, showsPlacement } from '../src/placements';

describe('rankHistory', () => {
  // Three teams, three games each; points per game.
  const a = [10, 0, 30];
  const b = [5, 20, 0];
  const c = [0, 1, 50];
  const after = rankHistory([a, b, c]);

  it("ranks a team after each of its games by everyone's running total", () => {
    // Totals after game 1: a 10, b 5, c 0. After 2: a 10, b 25, c 1. After 3: a 40, b 25, c 51.
    expect(after(a)).toEqual([1, 2, 2]);
    expect(after(b)).toEqual([2, 1, 3]);
    expect(after(c)).toEqual([3, 3, 1]);
  });

  it('shares the better rank on ties, and counts teams with fewer games at their total so far', () => {
    const tied = rankHistory([[10], [10, 5], [3, 3, 3]]);
    expect(tied([10])).toEqual([1]);
    expect(tied([10, 5])).toEqual([1, 1]);
    // After game 3 the one-game team still has 10 and the two-game team 15.
    expect(tied([3, 3, 3])).toEqual([3, 3, 3]);
  });

  it('handles an empty board', () => {
    expect(rankHistory([])([5])).toEqual([]);
  });
});

describe('showsPlacement', () => {
  it('is on for qualified rounds, finals and every Performance Evaluation session', () => {
    expect(showsPlacement({ type: 'CASH_CUP' }, { stage: 'open' })).toBe(false);
    expect(showsPlacement({ type: 'CASH_CUP' }, { stage: 'final' })).toBe(true);
    expect(showsPlacement({ type: 'FNCS' }, { stage: 'qualified' })).toBe(true);
    expect(showsPlacement({ type: 'PERF_EVAL' }, { stage: 'open' })).toBe(true);
  });
});
