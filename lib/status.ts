import type { WindowState } from './types.js';

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

export type EventState = 'live' | 'upcoming' | 'ended';

/** Live if any session is live or wrapping up; upcoming if one is still to come; else ended. */
export function eventState(windows: WindowTimes[], now: Date = new Date()): EventState {
  let upcoming = false;
  for (const w of windows) {
    const s = windowState(w, now);
    if (s === 'live' || s === 'wrapping') return 'live';
    if (s === 'upcoming') upcoming = true;
  }
  return upcoming ? 'upcoming' : 'ended';
}

/** The session to point at: a live one first, else the soonest upcoming one. */
export function nextWindow<W extends WindowTimes>(windows: W[], now: Date = new Date()): W | undefined {
  const live = windows.find((w) => windowState(w, now) === 'live');
  if (live) return live;
  return windows
    .filter((w) => windowState(w, now) === 'upcoming')
    .sort((a, b) => new Date(a.begin).getTime() - new Date(b.begin).getTime())[0];
}

/** The session whose results to open first: a live one (the latest to start), else the one that ended last. */
export function latestWindow<W extends WindowTimes>(windows: W[], now: Date = new Date()): W | undefined {
  const started = windows.filter((w) => new Date(w.begin).getTime() <= now.getTime());
  const live = started.filter((w) => windowState(w, now) === 'live');
  const at = (w: W) => new Date(live.length ? w.begin : w.end).getTime();
  return (live.length ? live : started).reduce<W | undefined>(
    (best, w) => (best && at(best) >= at(w) ? best : w),
    undefined,
  );
}
