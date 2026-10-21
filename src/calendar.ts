// Calendar view (F4): sessions laid out by day in your time zone. Days are
// numbered like dayIndex() in format.ts (days since 1970-01-01 on the calendar in
// that zone), so month and week grids are plain arithmetic.

import type { EventInfo, EventWindow } from '../lib/types';
import { dayIndex } from './format';

export interface DaySession {
  event: EventInfo;
  w: EventWindow;
}

const DAY_MS = 86_400_000;

/** 0 = Sunday. 1970-01-01 was a Thursday. */
export const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;

/** "2026-10-21" */
export const dayKey = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function dayFromKey(key: string | null): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!m) return undefined;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? undefined : t / DAY_MS;
}

/** Sessions by the day they start in `tz`, earliest first. */
export function sessionsByDay(events: EventInfo[], tz: string): Map<number, DaySession[]> {
  const out = new Map<number, DaySession[]>();
  for (const event of events)
    for (const w of event.windows) {
      const d = dayIndex(w.begin, tz);
      out.set(d, [...(out.get(d) ?? []), { event, w }]);
    }
  for (const list of out.values()) list.sort((a, b) => a.w.begin.localeCompare(b.w.begin));
  return out;
}

/** The weeks, Sunday first, covering the month that `day` is in. */
export function monthWeeks(day: number): number[][] {
  const d = new Date(day * DAY_MS);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS;
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS;
  const weeks: number[][] = [];
  for (let start = first - weekday(first); start < next; start += 7)
    weeks.push(Array.from({ length: 7 }, (_, i) => start + i));
  return weeks;
}

/** Sunday to Saturday around `day`. */
export const weekDays = (day: number) => Array.from({ length: 7 }, (_, i) => day - weekday(day) + i);

/** The same date `by` months away, kept inside that month (Jan 31 + 1 month = Feb 28). */
export function shiftMonth(day: number, by: number): number {
  const d = new Date(day * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + by;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last)) / DAY_MS;
}

const label = (opts: Intl.DateTimeFormatOptions) => (day: number) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(day * DAY_MS));
/** "October 2026" */
export const monthLabel = label({ month: 'long', year: 'numeric' });
/** "Wed, Oct 21" */
export const dayLabel = label({ weekday: 'short', month: 'short', day: 'numeric' });
/** 21 */
export const dayOfMonth = (day: number) => new Date(day * DAY_MS).getUTCDate();
export const sameMonth = (a: number, b: number) => dayKey(a).slice(0, 7) === dayKey(b).slice(0, 7);
