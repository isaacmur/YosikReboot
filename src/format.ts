// Display formatting. Times arrive as UTC ISO strings and are shown in the
// time zone from settings (Eastern by default).

import { useEffect, useState } from 'react';
import type { EventType, Mode, Region, TeamSize } from '../lib/types';

export const REGION_LABEL: Record<Region, string> = {
  NAC: 'NA Central',
  NAE: 'NA East',
  NAW: 'NA West',
  EU: 'Europe',
  BR: 'Brazil',
  OCE: 'Oceania',
  ME: 'Middle East',
  ASIA: 'Asia',
};

export const TYPE_LABEL: Record<EventType, string> = {
  FNCS: 'FNCS',
  RANKED_CUP: 'Ranked Cup',
  PROMO_CUP: 'Promo Cup',
  CASH_CUP: 'Cash Cup',
  VICTORY_CUP: 'Victory Cup',
  PERF_EVAL: 'Performance Evaluation',
  OTHER: 'Other',
};

export const MODE_LABEL: Record<Mode, string> = { BR: 'Battle Royale', RELOAD: 'Reload', OTHER: 'Other' };
export const TEAM_LABEL: Record<TeamSize, string> = { 1: 'Solo', 2: 'Duos', 3: 'Trios', 4: 'Squads' };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

const DAY = { weekday: 'short', month: 'short', day: 'numeric' } as const;
const TIME = { hour: 'numeric', minute: '2-digit' } as const;

/** "Tue, Oct 21" */
export const formatDay = (iso: string, tz: string) => fmt(tz, DAY).format(new Date(iso));
/** "7:00 PM" */
export const formatTime = (iso: string, tz: string) => fmt(tz, TIME).format(new Date(iso));
/** "Tue, Oct 21, 7:00 PM" */
export const formatDateTime = (iso: string, tz: string) => fmt(tz, { ...DAY, ...TIME }).format(new Date(iso));

/** "EDT" (or "GMT+1" where there is no common abbreviation). */
export function zoneAbbrev(tz: string, at: string | Date = new Date()): string {
  return (
    fmt(tz, { timeZoneName: 'short' })
      .formatToParts(new Date(at))
      .find((p) => p.type === 'timeZoneName')?.value ?? tz
  );
}

/** "Tue, Oct 21, 7:00 – 10:00 PM EDT", spanning days when needed. */
export function formatRange(begin: string, end: string, tz: string): string {
  const sameDay = formatDay(begin, tz) === formatDay(end, tz);
  const right = sameDay ? formatTime(end, tz) : formatDateTime(end, tz);
  return `${formatDateTime(begin, tz)} – ${right} ${zoneAbbrev(tz, begin)}`;
}

/** "2d 3h", "3h 12m", "12m 05s" */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/** "1st", "22nd", "113th", with thousands separators. */
export function ordinal(n: number): string {
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n.toLocaleString('en-US')}${teen ? 'th' : (suffixes[n % 10] ?? 'th')}`;
}

/** "12 s ago" under a minute, else like formatAgo. */
export function formatSecondsAgo(at: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  return s < 60 ? `${s} s ago` : formatAgo(at.toISOString(), now);
}

/** "just now", "4 min ago", "2 h ago" */
export function formatAgo(iso: string, now: Date): string {
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

/** Current time, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
