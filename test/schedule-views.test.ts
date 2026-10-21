// Search (F8), the calendar grid (F4) and merging regions (D22), against the
// captured schedules.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexCms } from '../lib/epic/cms';
import { normalizeEvents } from '../lib/epic/events';
import type { EventsResponse } from '../lib/types';
import { dayFromKey, dayKey, monthWeeks, sessionsByDay, shiftMonth, weekday, weekDays } from '../src/calendar';
import { dayIndex } from '../src/format';
import { searchEvents, tokenScore, words } from '../src/search';
import { mergeRegions } from '../src/useEvents';

const load = (f: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures/epic/first', f), 'utf8'));
const cms = indexCms(load('cms-tournamentinformation.json'));
const events = (region: string) => normalizeEvents(load(`events-download-${region}.json`), cms);
const NAC = events('NAC');
const TZ = 'America/New_York';

describe('search', () => {
  it('splits names and IDs into words', () => {
    expect(words('S42_ReloadCashCup_DuosZB_Event6Round1_NAC')).toEqual([
      's42',
      'reload',
      'cash',
      'cup',
      'duos',
      'zb',
      'event',
      '6',
      'round',
      '1',
      'nac',
    ]);
    expect(words('Café Cup!')).toEqual(['cafe', 'cup']);
    expect(tokenScore('cup', ['cup'])).toBe(4);
    expect(tokenScore('cu', ['cup'])).toBe(3);
    expect(tokenScore('lend', ['slender'])).toBe(2);
    expect(tokenScore('slndr', ['slender'])).toBe(1);
    expect(tokenScore('2', ['s42'])).toBe(0);
  });

  it('finds events by name, with typos, and puts the best match first', () => {
    const lady = searchEvents(NAC, 'lady liberty', TZ);
    expect(lady[0]!.event.name).toBe('Lady Liberty Cup');
    expect(lady[0]!.windows).toEqual([]);
    expect(searchEvents(NAC, 'slendr', TZ).some((h) => /Slender/i.test(h.event.name))).toBe(true);
    expect(searchEvents(NAC, 'no such event anywhere', TZ)).toEqual([]);
    expect(searchEvents(NAC, '   ', TZ)).toEqual([]);
  });

  it('narrows to the sessions a query names', () => {
    const hits = searchEvents(NAC, 'reload cash cup round 2', TZ);
    const cash = hits.find((h) => h.event.id === 'epicgames_S42_ReloadCashCup_DuosZB_NAC')!;
    expect(cash.windows.length).toBeGreaterThan(0);
    expect(cash.windows.every((w) => /Round2/.test(w.id))).toBe(true);
    // "event 6" picks out that event's two rounds.
    const six = searchEvents(NAC, 'reload cash cup event 6', TZ).find((h) => h.event.id === cash.event.id)!;
    expect(six.windows.map((w) => w.id).sort()).toEqual([
      'S42_ReloadCashCup_DuosZB_Event6Round1_NAC',
      'S42_ReloadCashCup_DuosZB_Event6Round2_NAC',
    ]);
  });

  it('puts your region first among equal matches', () => {
    const both = [...events('NAC'), ...events('NAW')].filter((e, i, all) => all.findIndex((x) => x.id === e.id) === i);
    const top = (prefer: string) => searchEvents(both, 'reload cash cup', TZ, prefer)[0]!.event.homeRegion;
    expect(top('NAC')).toBe('NAC');
    expect(top('NAW')).toBe('NAW');
  });

  it('matches tags and regions', () => {
    const zbDuos = searchEvents(NAC, 'zero build duos', TZ);
    expect(zbDuos.length).toBeGreaterThan(0);
    expect(zbDuos.every((h) => h.event.zeroBuild && h.event.teamSize === 2)).toBe(true);
    expect(searchEvents(NAC, 'naw ranked', TZ).every((h) => h.event.type === 'RANKED_CUP')).toBe(true);
  });
});

describe('calendar grid', () => {
  it('numbers days in the chosen time zone', () => {
    const oct21 = dayFromKey('2026-10-21')!;
    expect(dayKey(oct21)).toBe('2026-10-21');
    expect(weekday(oct21)).toBe(3); // Wednesday
    expect(dayFromKey('nope')).toBeUndefined();
    expect(weekDays(oct21).map(dayKey)).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
    ]);
  });

  it('lays out a month in Sunday-first weeks', () => {
    const weeks = monthWeeks(dayFromKey('2026-10-21')!);
    expect(weeks).toHaveLength(5);
    expect(dayKey(weeks[0]![0]!)).toBe('2026-09-27');
    expect(dayKey(weeks[4]![6]!)).toBe('2026-10-31');
    expect(dayKey(shiftMonth(dayFromKey('2026-01-31')!, 1))).toBe('2026-02-28');
    expect(dayKey(shiftMonth(dayFromKey('2026-01-15')!, -1))).toBe('2025-12-15');
  });

  it('puts a session on the day it starts in your time zone', () => {
    const byDay = sessionsByDay(NAC, TZ);
    const total = [...byDay.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(NAC.reduce((n, e) => n + e.windows.length, 0));
    // A 01:00 UTC start is the evening before in New York.
    const s = NAC.flatMap((e) => e.windows).find((w) => w.begin.startsWith('2026-10-21T01:00'))!;
    expect(dayKey(dayIndex(s.begin, TZ))).toBe('2026-10-20');
    expect(byDay.get(dayIndex(s.begin, TZ))!.some((x) => x.w.id === s.id)).toBe(true);
    for (const list of byDay.values())
      expect(list.map((x) => x.w.begin)).toEqual([...list.map((x) => x.w.begin)].sort());
  });
});

describe('all regions', () => {
  it('lists each event once, from the first region that has it', () => {
    const lists = ['NAC', 'NAE', 'NAW'].map((r): EventsResponse => ({
      region: r as 'NAC',
      fetchedAt: '',
      events: events(r),
    }));
    const merged = mergeRegions(lists);
    expect(new Set(merged.map((e) => e.id)).size).toBe(merged.length);
    // NAE lists NAC and NAW events (D11), so it adds nothing new here.
    expect(merged.length).toBe(mergeRegions([lists[0]!, lists[2]!]).length);
  });
});
