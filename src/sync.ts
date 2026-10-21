// Sync with Epic (D30): sign in with your own account once, read your row in
// every session Epic lists you in, keep each result like a board search, and end
// the Epic session however the sync ends. The sign-in itself never reaches this
// code: it rides in an HttpOnly cookie only /api/sync can read.

import { windowState } from '../lib/status';
import type {
  EventInfo,
  EventsResponse,
  EventWindow,
  Region,
  SyncPoll,
  SyncRows,
  SyncSession,
  SyncStart,
} from '../lib/types';
import { apiGetCached, apiPost } from './api';
import { sleep } from './boardIndex';
import { addFollow, setMe } from './follows';
import { regionOf } from './links';
import { isWindowChecked, markNotPlayed, markWindowChecked, recordResult } from './scan';
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
  /** Epic listed the sessions you played (else the latest sessions in your region were tried). */
  fromEpicList: boolean;
}

/** Sessions tried when Epic lists none for you: the latest finished ones in your region. */
const FALLBACK_SESSIONS = 40;
const BATCH = 8;

const last = createStore<SyncSummary | null>(
  'yr.sync.v1',
  (r) => (r && typeof r === 'object' && typeof (r as SyncSummary).at === 'string' ? (r as SyncSummary) : null),
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

    // What to read: the sessions Epic lists you in, else the latest finished ones in your region.
    const now = new Date();
    const regionSessions = finished((await eventsIn(o.region)).events, now);
    // A copy: the queue is used up as it's read, and the list is needed again below.
    const queue: SyncSession[] = ready.played
      ? [...ready.played]
      : regionSessions
          .filter(({ event, w }) => !isWindowChecked(event.id, w.id, me))
          .sort((a, b) => b.w.end.localeCompare(a.w.end))
          .slice(0, FALLBACK_SESSIONS)
          .map(({ event, w }) => ({ eventId: event.id, windowId: w.id }));
    const total = queue.length;
    let done = 0;
    let found = 0;
    o.onProgress({ step: 'reading', displayName, done, total });

    while (queue.length) {
      aborted();
      const batch = queue.splice(0, BATCH);
      const res = await apiPost<SyncRows>('/api/sync?step=rows', { sessions: batch });
      if (!res.results.length) throw new Error('Reading your sessions stalled. Try again.');
      queue.unshift(...res.remaining);
      for (const r of res.results) {
        const info = await sessionInfo(r);
        if (r.status === 'found' && r.entry && r.board) {
          found++;
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
        } else if (r.status === 'not_found' && !ready.played && info?.event.teamSize === 1) {
          // A solo session read with just you: you didn't play it. (In team modes a miss might
          // mean a different team, so those stay for a manual check.)
          markNotPlayed(r.eventId, r.windowId, me);
        }
      }
      done += res.results.length;
      o.onProgress({ step: 'reading', displayName, done, total });
    }

    // Epic listed what you played, so your region's other finished sessions are ones you didn't.
    if (ready.played) {
      const played = new Set(ready.played.map((s) => `${s.eventId}|${s.windowId}`));
      for (const { event, w } of regionSessions)
        if (!played.has(`${event.id}|${w.id}`)) markNotPlayed(event.id, w.id, me);
    }

    addFollow(me, displayName);
    setMe(me);
    const summary: SyncSummary = {
      at: new Date().toISOString(),
      accountId: me,
      displayName,
      sessions: done,
      found,
      fromEpicList: !!ready.played,
    };
    last.set(summary);
    return summary;
  } finally {
    await endSync();
  }
}
