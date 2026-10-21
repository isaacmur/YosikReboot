import type { WindowState } from './types';

/** Used when Epic omits payoutDelay (or sends something unusable). */
export const DEFAULT_PAYOUT_DELAY_MIN = 60;

export interface WindowTimes {
  begin: string | Date;
  end: string | Date;
  /** Minutes after `end` during which standings can still change. */
  payoutDelayMin?: number | null;
}

export function payoutDelayMs(minutes: number | null | undefined): number {
  const m =
    typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_PAYOUT_DELAY_MIN;
  return m * 60_000;
}

export function windowState(w: WindowTimes, now: Date = new Date()): WindowState {
  const t = now.getTime();
  const begin = new Date(w.begin).getTime();
  const end = new Date(w.end).getTime();
  if (t < begin) return 'upcoming';
  if (t < end) return 'live';
  if (t < end + payoutDelayMs(w.payoutDelayMin)) return 'wrapping';
  return 'final';
}

const CACHE_SECONDS: Record<WindowState, number> = {
  upcoming: 900,
  live: 30,
  wrapping: 300,
  final: 86_400,
};

/** `s-maxage` for a leaderboard or schedule response in this state. */
export function cacheSecondsFor(state: WindowState): number {
  return CACHE_SECONDS[state];
}

export const MIN_LIVE_REFRESH_MS = 30_000;
export const WRAPPING_REFRESH_MS = 5 * 60_000;

/** How often an open board refreshes; null means it doesn't. */
export function refreshMsFor(state: WindowState, liveSettingMs = 60_000): number | null {
  if (state === 'live') return Math.max(liveSettingMs, MIN_LIVE_REFRESH_MS);
  if (state === 'wrapping') return WRAPPING_REFRESH_MS;
  return null;
}
