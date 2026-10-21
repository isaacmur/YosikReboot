// Every event this browser has seen, kept for the season (D32). Epic's schedule
// lists an event only until about a week after it ends, and no Epic API lists
// older ones (`showPastEvents` stops at the same week), so without this a sync
// could never ask Epic's history about them. Trackers like Osirion keep their
// own archive for the same reason. Filled from every schedule the app reads.

import type { EventArt, EventInfo, EventWindow, TeamSize } from '../lib/types';
import { createStore } from './store';

/** What a sync and the results list need of an event once Epic stops listing it. */
export interface KeptEvent {
  id: string;
  name: string;
  teamSize: TeamSize | null;
  art: EventArt;
  /** Empty for events from before this browser kept any (EARLIER). */
  windows: Pick<EventWindow, 'id' | 'label' | 'begin' | 'end' | 'payoutDelayMin'>[];
}

/** About a season: older events are dropped. */
const KEEP_DAYS = 120;

/**
 * Events this season that Epic had stopped listing before this archive existed,
 * so a sync still asks about them once. IDs from Fortnite Tracker's event pages.
 */
const EARLIER: KeptEvent[] = [
  ...(['NAC', 'NAW', 'EU', 'BR', 'OCE', 'ME', 'ASIA'] as const).map((r) => ({
    id: `epicgames_S42_FNCSSoloQualifiers_${r}`,
    name: `[${r}] FNCS Solos Qualifiers`,
    teamSize: 1 as const,
    art: {},
    windows: [],
  })),
  ...(['NAC', 'NAW', 'BR', 'OCE', 'ME'] as const).map((r) => ({
    id: `epicgames_S42_StreetFighterCup_${r}`,
    name: 'Street Fighter Cup Reload',
    teamSize: null,
    art: {},
    windows: [],
  })),
];

const kept = createStore<Record<string, KeptEvent>>(
  'yr.events.v1',
  (r) => (r && typeof r === 'object' ? (r as Record<string, KeptEvent>) : {}),
  {},
);

const lastEnd = (e: KeptEvent) => e.windows.reduce((t, w) => (w.end > t ? w.end : t), '');

/** Keeps a trimmed copy of each event, updating ones whose sessions changed, and drops last season's. */
export function rememberEvents(events: EventInfo[], now = Date.now()): void {
  const prev = kept.get();
  const next: Record<string, KeptEvent> = {};
  const since = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  let changed = false;
  for (const [id, e] of Object.entries(prev))
    if (lastEnd(e) >= since) next[id] = e;
    else changed = true;
  for (const e of events) {
    const copy: KeptEvent = {
      id: e.id,
      name: e.name,
      teamSize: e.teamSize,
      art: e.art,
      windows: e.windows.map(({ id, label, begin, end, payoutDelayMin }) => ({
        id,
        label,
        begin,
        end,
        payoutDelayMin,
      })),
    };
    const old = next[e.id];
    if (old && old.windows.length === copy.windows.length && lastEnd(old) === lastEnd(copy)) continue;
    next[e.id] = copy;
    changed = true;
  }
  if (changed) kept.set(next);
}

/** Every kept event, and the earlier ones this browser never saw listed. */
export function keptEvents(): KeptEvent[] {
  const all = kept.get();
  return [...Object.values(all), ...EARLIER.filter((e) => !all[e.id])];
}

export function keptEvent(id: string): KeptEvent | undefined {
  return kept.get()[id] ?? EARLIER.find((e) => e.id === id);
}
