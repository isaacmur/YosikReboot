import { describe, expect, it } from 'vitest';
import { cacheSecondsFor, DEFAULT_PAYOUT_DELAY_MIN, payoutDelayMs, refreshMsFor, windowState } from '../lib/status';

const w = { begin: '2026-10-21T18:00:00Z', end: '2026-10-21T21:00:00Z', payoutDelayMin: 30 };
const at = (s: string) => new Date(s);

describe('windowState', () => {
  it('walks upcoming -> live -> wrapping -> final at the exact boundaries', () => {
    expect(windowState(w, at('2026-10-21T17:59:59.999Z'))).toBe('upcoming');
    expect(windowState(w, at('2026-10-21T18:00:00Z'))).toBe('live');
    expect(windowState(w, at('2026-10-21T20:59:59.999Z'))).toBe('live');
    expect(windowState(w, at('2026-10-21T21:00:00Z'))).toBe('wrapping');
    expect(windowState(w, at('2026-10-21T21:29:59.999Z'))).toBe('wrapping');
    expect(windowState(w, at('2026-10-21T21:30:00Z'))).toBe('final');
  });

  it('defaults to a 60-minute wrap-up when payoutDelay is missing or unusable', () => {
    for (const payoutDelayMin of [undefined, null, NaN, -5]) {
      const win = { ...w, payoutDelayMin };
      expect(windowState(win, at('2026-10-21T21:59:00Z'))).toBe('wrapping');
      expect(windowState(win, at('2026-10-21T22:00:00Z'))).toBe('final');
    }
  });

  it('treats payoutDelay 0 as zero, not as missing', () => {
    expect(windowState({ ...w, payoutDelayMin: 0 }, at('2026-10-21T21:00:00Z'))).toBe('final');
  });

  it('accepts Date objects', () => {
    expect(windowState({ begin: new Date(0), end: new Date(1000) }, new Date(500))).toBe('live');
  });
});

describe('payoutDelayMs', () => {
  it('converts minutes and falls back to the default', () => {
    expect(payoutDelayMs(2)).toBe(120_000);
    expect(payoutDelayMs(undefined)).toBe(DEFAULT_PAYOUT_DELAY_MIN * 60_000);
  });
});

describe('cache and refresh rules', () => {
  it('matches the plan: live 30 s, wrapping 5 min, final 24 h, schedule 15 min', () => {
    expect(cacheSecondsFor('live')).toBe(30);
    expect(cacheSecondsFor('wrapping')).toBe(300);
    expect(cacheSecondsFor('final')).toBe(86_400);
    expect(cacheSecondsFor('upcoming')).toBe(900);
  });

  it('refreshes live boards at the setting but never faster than 30 s', () => {
    expect(refreshMsFor('live')).toBe(60_000);
    expect(refreshMsFor('live', 45_000)).toBe(45_000);
    expect(refreshMsFor('live', 5_000)).toBe(30_000);
    expect(refreshMsFor('wrapping', 5_000)).toBe(300_000);
    expect(refreshMsFor('final')).toBeNull();
    expect(refreshMsFor('upcoming')).toBeNull();
  });
});
