// Sync with Epic (D30): sign in with your own account once, read Epic's history
// of your results in every event this season, in every region, keep each result
// like a board search, and end the Epic session however the sync ends. The
// sign-in itself never reaches this code: it rides in an HttpOnly cookie only
// /api/sync can read.

import { windowState } from '../lib/status';
import {
  REGIONS,
  type EventInfo,
  type EventsResponse,
  type Region,
  type SyncEventHistory,
  type SyncHistory,
  type SyncPoll,
  type SyncRowResult,
  type SyncRows,
  type SyncSession,
  type SyncStart,
} from '../lib/types';
import { apiGetCached, apiPost } from './api';
import { sleep } from './boardIndex';
import { addFollow, setMe } from './follows';
import { ordinal, plural } from './format';
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
  /** Events whose history was read. */
  events: number;
  /** Results kept from them. */
  found: number;
  /** What Epic returned, in plain lines, for when results are missing. */
  details: string[];
}

/** Events per history request (one Epic call each), and sessions per rows request. */
const EVENTS_PER_REQUEST = 12;
const BATCH = 8;
/** Results a board search already found, compared with Epic's history as a check. */
const KNOWN = 3;
/** Events listed one by one in the details. */
const LISTED = 25;

const last = createStore<SyncSummary | null>(
  'yr.sync.v3',
  (r) =>
    r &&
    typeof r === 'object' &&
    Array.isArray((r as SyncSummary).details) &&
    typeof (r as SyncSummary).events === 'number'
      ? (r as SyncSummary)
      : null,
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

const keyOf = (x: { eventId: string; windowId: string }) => `${x.eventId}|${x.windowId}`;

export async function syncWithEpic(o: {
  region: Region;
  signal: AbortSignal;
  onProgress: (p: SyncProgress) => void;
}): Promise<SyncSummary> {
  const aborted = () => {
    if (o.signal.aborted) throw new DOMException('Aborted', 'AbortError');
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
    const now = new Date();
    const details: string[] = [
      `Your schedule download: player part ${ready.epic.playerKeys.join(', ') || 'empty'}; ` +
        `${ready.epic.teams} teams, ${ready.epic.tokens} tokens, ${ready.epic.scores} scores.`,
    ];

    // Every event this season, in every region (you can play outside yours), the one copy of each.
    const events = new Map<string, EventInfo>();
    for (const list of await Promise.all(
      REGIONS.map((r) => apiGetCached<EventsResponse>(`/api/events?region=${r}`, 15 * 60_000)),
    ))
      for (const e of list.events) if (!events.has(e.id)) events.set(e.id, e);
    const finals = (e: EventInfo) => e.windows.filter((w) => windowState(w, now) === 'final');
    const label = (x: { eventId: string; windowId: string }) => {
      const e = events.get(x.eventId);
      const w = e?.windows.find((y) => y.id === x.windowId);
      return e && w ? `${e.name} · ${w.label}` : x.windowId;
    };

    // Up to three results a board search found (not an earlier sync) are read again, as a check on Epic's history.
    const known = allScans()
      .filter((x) => x.final && x.pagesScanned > 0 && x.found[me] && events.has(x.eventId))
      .slice(0, KNOWN)
      .map((x) => ({ eventId: x.eventId, windowId: x.windowId, rank: x.found[me]!.rank }));
    // Events with a finished session not yet settled for you: your region's first, then by region, so each
    // request reads one schedule (global events are served from NAE's).
    const home = (id: string) => regionOf(id) ?? 'NAE';
    const queue = [...events.values()]
      .filter((e) => known.some((k) => k.eventId === e.id) || finals(e).some((w) => !isWindowChecked(e.id, w.id, me)))
      .map((e) => e.id)
      .sort(
        (a, b) =>
          Number(home(a) !== o.region) - Number(home(b) !== o.region) ||
          home(a).localeCompare(home(b)) ||
          a.localeCompare(b),
      );

    let total = queue.length;
    let done = 0;
    let found = 0;
    o.onProgress({ step: 'reading', displayName, done, total });
    const keep = (r: SyncRowResult) => {
      if (r.status !== 'found' || !r.entry || !r.board) return;
      const w = events.get(r.eventId)?.windows.find((x) => x.id === r.windowId);
      recordResult(
        {
          eventId: r.eventId,
          windowId: r.windowId,
          board: r.board.id,
          boardLabel: r.board.label,
          payouts: r.board.payouts,
          title: w ? label(r) : undefined,
          endedAt: w?.end,
        },
        me,
        r.entry,
      );
      markWindowChecked(r.eventId, r.windowId, me);
      found++;
    };

    // 1: Epic's history, one call per event: every session you played in it, with your rank.
    const read: SyncEventHistory[] = [];
    const toRead: SyncSession[] = [];
    while (queue.length) {
      aborted();
      const res = await apiPost<SyncHistory>('/api/sync?step=history', { events: queue.splice(0, EVENTS_PER_REQUEST) });
      if (!res.events.length) throw new Error('Reading your history stalled. Try again.');
      queue.unshift(...res.remaining);
      for (const h of res.events) {
        read.push(h);
        h.results.forEach(keep);
        toRead.push(...h.toRead);
      }
      done += res.events.length;
      o.onProgress({ step: 'reading', displayName, done, total });
      // Forbidden for every event so far: it won't answer for the rest either.
      if (read.every((h) => h.error?.startsWith('403'))) break;
    }

    // 2: Sessions the history has you in without your standing (a Ranked Cup's tiers): read with your team.
    const rowMisses: string[] = [];
    total += toRead.length;
    while (toRead.length) {
      aborted();
      const res = await apiPost<SyncRows>('/api/sync?step=rows', { sessions: toRead.splice(0, BATCH) });
      if (!res.results.length) throw new Error('Reading your sessions stalled. Try again.');
      toRead.unshift(...res.remaining);
      for (const r of res.results) {
        keep(r);
        if (r.status !== 'found')
          rowMisses.push(`${label(r)}: ${r.status.replace('_', ' ')}. Epic said: ${r.trace?.join('; ') || '—'}`);
      }
      done += res.results.length;
      o.onProgress({ step: 'reading', displayName, done, total });
    }

    const answered = read.filter((h) => !h.error);
    const refused = read.filter((h) => h.error);
    const withScores = answered.filter((h) => h.played.length);
    details.push(
      `Epic's history: asked about ${plural(read.length, 'event')}; ${plural(answered.length, 'answer')}, ` +
        `${withScores.length} with sessions you played.`,
    );
    for (const h of withScores.slice(0, LISTED)) {
      const kept = new Map(h.results.map((r) => [r.windowId, r]));
      const sessions = h.played.map((w) => {
        const x = { eventId: h.eventId, windowId: w };
        const r = kept.get(w);
        const name = events.get(h.eventId)?.windows.find((y) => y.id === w)?.label ?? w;
        if (r?.entry)
          return `${name} ${ordinal(r.entry.rank)}${r.board?.label === 'Overall' ? '' : ` (${r.board?.label})`}`;
        return `${name} (${h.toRead.some((t) => keyOf(t) === keyOf(x)) ? 'read from the board' : 'not final yet'})`;
      });
      details.push(
        `${events.get(h.eventId)?.name ?? h.eventId}: ${sessions.join('; ')}` +
          (h.unmatched ? `; ${plural(h.unmatched, 'score')} on no board of this event` : ''),
      );
    }
    if (withScores.length > LISTED) details.push(`…and ${withScores.length - LISTED} more events.`);
    if (refused.length)
      details.push(
        `Epic didn't return the history for ${plural(refused.length, 'event')}, e.g. ` +
          `${events.get(refused[0]!.eventId)?.name ?? refused[0]!.eventId}: ${refused[0]!.error}`,
      );
    details.push(...rowMisses);

    // The check: a result a board search found should be in Epic's history too.
    let trusted = true;
    for (const k of known) {
      const h = answered.find((x) => x.eventId === k.eventId);
      if (!h) continue;
      const r = h.results.find((x) => x.windowId === k.windowId);
      const listed = h.played.includes(k.windowId);
      if (!listed) trusted = false;
      details.push(
        `Check on ${label(k)}: a board search found you ${ordinal(k.rank)}; Epic's history ` +
          (r?.entry ? `says ${ordinal(r.entry.rank)}.` : listed ? 'has you in it.' : "doesn't list it."),
      );
    }

    // The history lists every session you played in an event, so its finished sessions it doesn't list are ones
    // you didn't. Only for team sizes it has shown it lists (in case it misses some kinds of team), and only if
    // every check above held.
    let skipped = 0;
    const sizes = new Set(withScores.map((h) => events.get(h.eventId)?.teamSize));
    if (trusted)
      for (const h of answered) {
        const e = events.get(h.eventId);
        if (!e || h.unmatched || !sizes.has(e.teamSize)) continue;
        for (const w of finals(e))
          if (!h.played.includes(w.id) && !isWindowChecked(e.id, w.id, me)) {
            markNotPlayed(e.id, w.id, me);
            skipped++;
          }
      }
    details.push(
      `Kept ${plural(found, 'result')}` +
        (skipped ? `; ${plural(skipped, 'finished session')} you didn't play left off the list to check.` : '.'),
    );

    addFollow(me, displayName);
    setMe(me);
    const summary: SyncSummary = {
      at: new Date().toISOString(),
      accountId: me,
      displayName,
      events: read.length,
      found,
      details,
    };
    last.set(summary);
    return summary;
  } finally {
    await endSync();
  }
}
