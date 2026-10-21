// Sync with Epic (D30): sign in with your own account once, read your row in
// your recent sessions, keep each result like a board search, and end the Epic
// session however the sync ends. The sign-in itself never reaches this
// code: it rides in an HttpOnly cookie only /api/sync can read.

import { windowState } from '../lib/status';
import type {
  EventInfo,
  EventsResponse,
  EventWindow,
  Region,
  SyncPoll,
  SyncProbe,
  SyncRows,
  SyncSession,
  SyncStart,
} from '../lib/types';
import { apiGetCached, apiPost } from './api';
import { sleep } from './boardIndex';
import { addFollow, setMe } from './follows';
import { plural } from './format';
import { regionOf } from './links';
import { allScans, isWindowChecked, markNotPlayed, markWindowChecked, recordResult } from './scan';
import { createStore } from './store';

export interface SyncProgress {
  step: 'starting' | 'approve' | 'reading';
  url?: string;
  code?: string;
  expiresAt?: string;
  displayName?: string;
  done?: number;
  total?: number;
}

export interface SyncSummary {
  at: string;
  accountId: string;
  displayName: string;
  /** Sessions read. */
  sessions: number;
  /** Results found among them. */
  found: number;
  /** A session you're known to have played came back without your row, so the rest weren't read. */
  stoppedEarly: boolean;
  /** What Epic returned, in plain lines, for when results are missing. */
  details: string[];
}

/** Recent sessions read: your region's finished ones from the last three weeks, newest first. */
const RECENT_DAYS = 21;
const MAX_SESSIONS = 60;
/** Sessions a board search already found you in, read first as a check. */
const KNOWN = 2;
const BATCH = 8;

const last = createStore<SyncSummary | null>(
  'yr.sync.v2',
  (r) => (r && typeof r === 'object' && Array.isArray((r as SyncSummary).details) ? (r as SyncSummary) : null),
  null,
);
export const useLastSync = last.use;

/** Ends the Epic session on the server; safe to call more than once, and while the page closes. */
export function endSync(): Promise<void> {
  return fetch('/api/sync', { method: 'DELETE', credentials: 'same-origin', keepalive: true }).then(
    () => undefined,
    () => undefined,
  );
}

const finished = (events: EventInfo[], now: Date) =>
  events.flatMap((event) => event.windows.filter((w) => windowState(w, now) === 'final').map((w) => ({ event, w })));

export async function syncWithEpic(o: {
  region: Region;
  signal: AbortSignal;
  onProgress: (p: SyncProgress) => void;
}): Promise<SyncSummary> {
  const aborted = () => {
    if (o.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const schedules = new Map<Region, Promise<EventsResponse>>();
  const eventsIn = (r: Region) => {
    if (!schedules.has(r)) schedules.set(r, apiGetCached<EventsResponse>(`/api/events?region=${r}`, 15 * 60_000));
    return schedules.get(r)!;
  };
  const sessionInfo = async (s: SyncSession): Promise<{ event: EventInfo; w: EventWindow } | undefined> => {
    const { events } = await eventsIn(regionOf(s.eventId) ?? o.region);
    const event = events.find((e) => e.id === s.eventId);
    const w = event?.windows.find((x) => x.id === s.windowId);
    return event && w ? { event, w } : undefined;
  };

  try {
    o.onProgress({ step: 'starting' });
    const start = await apiPost<SyncStart>('/api/sync?step=start');
    o.onProgress({ step: 'approve', url: start.url, code: start.code, expiresAt: start.expiresAt });

    let interval = start.intervalMs;
    let ready: Extract<SyncPoll, { status: 'ready' }> | undefined;
    while (!ready) {
      await sleep(interval, o.signal);
      if (Date.now() > Date.parse(start.expiresAt)) throw new Error('The sign-in link expired. Start the sync again.');
      const poll = await apiPost<SyncPoll>(`/api/sync?step=poll&region=${o.region}`);
      if (poll.status === 'ready') ready = poll;
      else interval = poll.intervalMs;
    }
    aborted();
    const me = ready.accountId;
    const displayName = ready.displayName ?? 'You';
    const keyOf = (x: { eventId: string; windowId: string }) => `${x.eventId}|${x.windowId}`;
    const details: string[] = [];
    const label = async (x: SyncSession) => {
      const info = await sessionInfo(x);
      return info ? `${info.event.name} · ${info.w.label}` : x.windowId;
    };

    // What to read, in order. 1: up to two sessions a board search already found you in, as a
    // check: if Epic's filtered boards don't return your row there, they won't anywhere, so the
    // sync stops instead of spending calls. 2: what Epic's `player.teams` lists, with your team.
    // 3: your region's finished sessions from the last three weeks you haven't checked.
    const now = new Date();
    const known = allScans()
      .filter((x) => x.final && x.found[me])
      .slice(0, KNOWN)
      .map((x) => ({ eventId: x.eventId, windowId: x.windowId, rank: x.found[me]!.rank }));
    const since = now.getTime() - RECENT_DAYS * 86_400_000;
    const recent = finished((await eventsIn(o.region)).events, now)
      .filter(({ event, w }) => Date.parse(w.end) > since && !isWindowChecked(event.id, w.id, me))
      .sort((a, b) => b.w.end.localeCompare(a.w.end))
      .map(({ event, w }): SyncSession => ({ eventId: event.id, windowId: w.id }));
    const queue: SyncSession[] = [];
    const seen = new Set<string>();
    for (const x of [
      ...known.map(({ eventId, windowId }) => ({ eventId, windowId })),
      ...(ready.played ?? []),
      ...recent,
    ])
      if (!seen.has(keyOf(x)) && queue.length < MAX_SESSIONS) {
        seen.add(keyOf(x));
        queue.push(x);
      }
    const knownKeys = new Set(known.map(keyOf));
    const listedKeys = new Set((ready.played ?? []).map(keyOf));

    details.push(
      ready.played
        ? `Epic's list for you (player.teams) had ${ready.played.length}: ${(await Promise.all(ready.played.slice(0, 6).map(label))).join('; ')}`
        : "Epic's list for you (player.teams) was empty.",
      `Your schedule's player part: ${ready.epic.playerKeys.join(', ') || 'nothing'} · ${ready.epic.tokens} tokens`,
    );

    const total = queue.length;
    let done = 0;
    let found = 0;
    /** Whether Epic's filtered boards return your row: yes once any row comes back, no if a known one doesn't. */
    let filterWorks: boolean | undefined;
    let missedKnown: SyncSession | undefined;
    /** Solo sessions read without your row; they count as not played once the filter is shown to work. */
    const soloMisses: SyncSession[] = [];
    const counts = { found: 0, not_found: 0, not_final: 0, unknown: 0 };
    o.onProgress({ step: 'reading', displayName, done, total });

    // The check goes first, on its own, so a miss there stops the sync before anything else is read.
    let first = known.length;
    while (queue.length && filterWorks !== false) {
      aborted();
      const batch = queue.splice(0, first || BATCH);
      first = 0;
      const res = await apiPost<SyncRows>('/api/sync?step=rows', { sessions: batch });
      if (!res.results.length) throw new Error('Reading your sessions stalled. Try again.');
      queue.unshift(...res.remaining);
      for (const r of res.results) {
        counts[r.status]++;
        const info = await sessionInfo(r);
        const isKnown = knownKeys.has(keyOf(r));
        if (isKnown) {
          const k = known.find((x) => keyOf(x) === keyOf(r))!;
          details.push(
            `Check on ${await label(r)}, where a board search found you at #${k.rank}: ` +
              `${r.status === 'found' ? `found (#${r.entry?.rank})` : r.status.replace('_', ' ')}. Epic said: ${r.trace?.join('; ') || '—'}`,
          );
          if (r.status === 'found') filterWorks = true;
          else if (r.status === 'not_found' && filterWorks === undefined) {
            filterWorks = false;
            missedKnown = r;
          }
        } else if (listedKeys.has(keyOf(r)))
          details.push(
            `Listed by Epic, ${await label(r)}: ${r.status.replace('_', ' ')}. Epic said: ${r.trace?.join('; ') || '—'}`,
          );

        if (r.status === 'found' && r.entry && r.board) {
          found++;
          filterWorks ??= true;
          recordResult(
            {
              eventId: r.eventId,
              windowId: r.windowId,
              board: r.board.id,
              boardLabel: r.board.label,
              payouts: r.board.payouts,
              title: info ? `${info.event.name} · ${info.w.label}` : undefined,
              endedAt: info?.w.end,
            },
            me,
            r.entry,
          );
          markWindowChecked(r.eventId, r.windowId, me);
        } else if (r.status === 'not_found' && info?.event.teamSize === 1) soloMisses.push(r);
      }
      done += res.results.length;
      o.onProgress({ step: 'reading', displayName, done, total });
    }

    // The filter returned your row somewhere, and in a solo session your team is just you: no row
    // means you didn't play. (In team modes a miss might be a different team, so those stay to check.)
    if (filterWorks) for (const m of soloMisses) markNotPlayed(m.eventId, m.windowId, me);

    if (missedKnown) {
      // Is Epic's per-player history any better? One call, for the next fix.
      const probe = await apiPost<SyncProbe>('/api/sync?step=probe', missedKnown);
      details.push(
        "Stopped early: Epic's filtered boards didn't return your row in a session you played, so the rest weren't read.",
        `Epic's history for ${await label(missedKnown)}: ${probe.history}`,
      );
    }
    details.push(
      `Read ${plural(done, 'session')}: ${counts.found} found, ${counts.not_found} without your row, ` +
        `${counts.not_final} not final yet, ${counts.unknown} not in this season's schedule.`,
    );

    addFollow(me, displayName);
    setMe(me);
    const summary: SyncSummary = {
      at: new Date().toISOString(),
      accountId: me,
      displayName,
      sessions: done,
      found,
      stoppedEarly: !!missedKnown,
      details,
    };
    last.set(summary);
    return summary;
  } finally {
    await endSync();
  }
}
