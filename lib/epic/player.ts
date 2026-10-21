// Your own results, read with your own sign-in during a sync (D30). Epic answers
// these only for the signed-in account (D10): its per-player history lists every
// score you have in an event, one call per event, and a board filtered to your
// team (`teamAccountIds=`) returns just your row, for the boards the history
// doesn't cover.

import { isAccountId } from '../validate.js';
import { boardInfos, boardLabel, boardRules, isFetchable, windowLocations, type ScoreLocation } from './boards.js';
import type { EpicClient } from './client.js';
import { endpoints } from './endpoints.js';
import { EpicHttpError } from './errors.js';
import { windowLabel } from './events.js';
import { asArr, asObj, num, str, strings } from './json.js';
import { liteEntry, normalizeEntries } from './leaderboard.js';
import { findWindow } from './schedule.js';
import { windowState } from '../status.js';
import {
  REGIONS,
  type BoardInfo,
  type Entry,
  type SyncEventHistory,
  type SyncRowResult,
  type SyncSession,
} from '../types.js';

export interface PlayedSession {
  eventId: string;
  windowId: string;
  /** Your team's account IDs, you included. */
  team: string[];
}

export type OwnRow = (
  | { status: 'found'; board: Pick<BoardInfo, 'id' | 'label' | 'payouts'>; entry: Entry }
  | { status: 'not_found' | 'not_final' | 'unknown' }
) & {
  /** What Epic answered for each board tried, for the sync's details. */
  trace?: string[];
};

/** Account IDs shortened, so details show what Epic said without listing whole IDs. */
const shortIds = (text: string) => text.replace(/\b([0-9a-f]{6})[0-9a-f]{26}\b/g, '$1…');

/** One line for an Epic error: status, code and the start of its message. */
export function describeError(err: EpicHttpError): string {
  const message = err.message ? `: ${shortIds(err.message).slice(0, 140)}` : '';
  return `${err.status} ${err.errorCode ?? 'error'}${message}`;
}

/**
 * The outline of a JSON value (keys, array lengths, numbers), never its strings,
 * so the sync's details can show what an Epic response looks like.
 */
export function shapeOf(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `[${v.length}${v.length && depth < 4 ? ` × ${shapeOf(v[0], depth + 1)}` : ''}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 4) return `{${keys.length} keys}`;
    const shown = keys.slice(0, 12).map((k) => `${k}: ${shapeOf((v as Record<string, unknown>)[k], depth + 1)}`);
    return `{${shown.join(', ')}${keys.length > 12 ? ', …' : ''}}`;
  }
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  return typeof v;
}

const isFinal = (window: Record<string, unknown>, now: number) =>
  windowState(
    {
      begin: str(window.beginTime) ?? '',
      end: str(window.endTime) ?? '',
      payoutDelayMin: num(window.payoutDelay) ?? null,
    },
    new Date(now),
  ) === 'final';

/**
 * Your row in one session: its scored boards (Ranked Cup tiers top first, once
 * the main board says you played), each filtered to your team, until it turns
 * up. `spend` is called before each Epic
 * call and returns false once the request's budget is used up (then: undefined).
 */
export async function ownRow(
  client: EpicClient,
  raw: unknown,
  s: PlayedSession,
  accountId: string,
  now: number,
  spend: () => boolean,
): Promise<OwnRow | undefined> {
  const ref = findWindow(raw, s.eventId, s.windowId);
  if (!ref) return { status: 'unknown', trace: ["not in this season's schedule"] };
  if (!isFinal(ref.window, now)) return { status: 'not_final', trace: ['results not final yet'] };
  const trace: string[] = [];
  const all = boardInfos(raw, s.eventId, s.windowId, ref.templateRules).filter((b) => !b.computed);
  const scored = all.filter((b) => b.hasPoints);
  const boards = scored.length ? [...scored].reverse() : all;

  /** Your row on one board: the entry, null if Epic answered without it, undefined if it refused or can't be read. */
  const read = async (b: BoardInfo): Promise<Entry | null | undefined> => {
    const loc = windowLocations(raw, s.eventId, s.windowId).find((l) => l.instance === b.id && isFetchable(l));
    if (!loc) return undefined;
    let body: Record<string, unknown> | undefined;
    try {
      body = asObj(
        await client.getJson(
          endpoints.leaderboard(loc.group, loc.instance, accountId, { teamAccountIds: s.team }),
          `your row ${b.label}`,
        ),
      );
    } catch (err) {
      // Not your team on this board (400) or no such board (404).
      if (err instanceof EpicHttpError && (err.status === 400 || err.status === 404)) {
        trace.push(`${b.label}: ${describeError(err)}`);
        return undefined;
      }
      throw err;
    }
    const rules = boardRules(raw, loc, loc.instance === s.windowId ? ref.templateRules : undefined);
    const rows = normalizeEntries(body, rules);
    const entry = rows.find((e) => e.members.some((m) => m.id === accountId));
    trace.push(
      `${b.label}: 200, ${rows.length} row${rows.length === 1 ? '' : 's'}${entry ? ` (rank ${entry.rank})` : ''}`,
    );
    return entry ?? null;
  };

  // A Ranked Cup's main board lists everyone (without points, D14): one call there says whether
  // you played at all, before the tiers (up to eight calls) say where.
  const main = all.find((b) => !b.hasPoints);
  if (main && scored.length) {
    if (!spend()) return undefined;
    if ((await read(main)) === null) return { status: 'not_found', trace };
  }
  for (const b of boards) {
    if (!spend()) return undefined;
    const entry = await read(b);
    if (entry)
      return {
        status: 'found',
        board: { id: b.id, label: b.label, payouts: b.payouts },
        entry: liteEntry(entry),
        trace,
      };
  }
  return { status: 'not_found', trace };
}

/** The board a history score is on, as `<group>:<instance>`: its `_scoreId` location if it names one, else its window. */
function scoreBoard(score: Record<string, unknown>, eventId: string): string | undefined {
  const key = asObj(score.scoreKey) ?? score;
  const loc = /^Fortnite:([^:]+):([^:]+)$/.exec(str(key._scoreId) ?? '');
  if (loc) return `${loc[1]}:${loc[2]}`;
  const windowId = str(key.eventWindowId);
  return windowId ? `${str(key.eventId) ?? eventId}:${windowId}` : undefined;
}

/**
 * Turns one event's history (a list of scores shaped like leaderboard entries,
 * each with a `scoreKey` naming its board) into your row per final session.
 * Ranked Cup standings are the tier boards (D14): when the history only has a
 * session's main board, the session goes to `toRead` with your team from it.
 */
export function historyResults(
  raw: unknown,
  eventId: string,
  scores: unknown[],
  accountId: string,
  now: number,
): Omit<SyncEventHistory, 'eventId' | 'error'> {
  const event = asArr(asObj(raw)?.events)
    .map(asObj)
    .find((e) => str(e?.eventId) === eventId);
  const boardsAt = new Map<string, { windowId: string; loc: ScoreLocation }>();
  for (const w of asArr(event?.eventWindows).map(asObj)) {
    const windowId = str(w?.eventWindowId);
    if (!windowId) continue;
    for (const loc of windowLocations(raw, eventId, windowId).filter(isFetchable))
      boardsAt.set(`${loc.group}:${loc.instance}`, { windowId, loc });
  }

  const byWindow = new Map<string, { loc: ScoreLocation; score: Record<string, unknown> }[]>();
  let unmatched = 0;
  for (const score of scores.map(asObj)) {
    const at = score && boardsAt.get(scoreBoard(score, eventId) ?? '');
    if (!score || !at) {
      unmatched++;
      continue;
    }
    byWindow.set(at.windowId, [...(byWindow.get(at.windowId) ?? []), { loc: at.loc, score }]);
  }

  const results: SyncRowResult[] = [];
  const toRead: SyncSession[] = [];
  for (const [windowId, found] of byWindow) {
    const ref = findWindow(raw, eventId, windowId);
    if (!ref || !isFinal(ref.window, now)) continue;
    const boards = boardInfos(raw, eventId, windowId, ref.templateRules).filter((b) => !b.computed);
    const scored = boards.filter((b) => b.hasPoints);
    // Your standing is on a scored board (the top tier you're on, as Epic lists them), else the only board there is.
    const pick = [...(scored.length ? scored : boards)]
      .reverse()
      .map((board) => ({ board, hit: found.find((f) => f.loc.instance === board.id) }))
      .find((x) => x.hit);
    const team = [
      ...new Set([accountId, ...found.flatMap((f) => strings(f.score.teamAccountIds)).filter(isAccountId)]),
    ];
    // A score without a rank (or rank 0) isn't a standing: the board is read instead.
    const entry =
      pick &&
      normalizeEntries(
        { entries: [pick.hit!.score] },
        boardRules(raw, pick.hit!.loc, pick.hit!.loc.instance === windowId ? ref.templateRules : undefined),
      ).find((e) => e.rank > 0);
    if (pick && entry)
      results.push({
        eventId,
        windowId,
        status: 'found',
        board: { id: pick.board.id, label: pick.board.label, payouts: pick.board.payouts },
        entry: liteEntry(entry),
        trace: [`history: ${pick.board.label}, rank ${entry.rank}`],
      });
    else toRead.push({ eventId, windowId, team: team.slice(0, 4) });
  }
  return { played: [...byWindow.keys()], results, toRead, unmatched };
}

/** A Ranked Cup tier board's ID: its window's, then `_<round>_<tier>` (see boards.ts). */
const TIER_BOARD = new RegExp(`^(.+_(?:${REGIONS.join('|')}))_\\d+_[A-Za-z]+$`);

/**
 * Like `historyResults`, for an event Epic's schedule no longer lists (it drops
 * events about a week after they end, D32): every session is long final, and
 * boards are told apart by their IDs alone. Without the schedule there are no
 * scoring rules or payouts, so rows carry Epic's points but not each game's.
 */
export function pastHistoryResults(eventId: string, scores: unknown[]): Omit<SyncEventHistory, 'eventId' | 'error'> {
  const byWindow = new Map<string, { loc: ScoreLocation; score: Record<string, unknown> }[]>();
  let unmatched = 0;
  for (const score of scores.map(asObj)) {
    const [group, instance] = (score && scoreBoard(score, eventId)?.split(':')) ?? [];
    if (!score || group !== eventId || !instance) {
      unmatched++;
      continue;
    }
    const windowId = TIER_BOARD.exec(instance)?.[1] ?? instance;
    const loc = { key: `Fortnite:${group}:${instance}`, group, instance };
    byWindow.set(windowId, [...(byWindow.get(windowId) ?? []), { loc, score }]);
  }

  const results: SyncRowResult[] = [];
  for (const [windowId, found] of byWindow) {
    // A tier board you scored on, else the session's own board, unless that's a Ranked Cup's (no points, D14).
    const tier = found.filter((f) => f.loc.instance !== windowId && (num(f.score.pointsEarned) ?? 0) > 0).pop();
    const pick = tier ?? (/RankedCup/i.test(eventId) ? undefined : found.find((f) => f.loc.instance === windowId));
    const entry = pick && normalizeEntries({ entries: [pick.score] }, []).find((e) => e.rank > 0);
    if (!pick || !entry) continue;
    const label = boardLabel(pick.loc, windowId);
    results.push({
      eventId,
      windowId,
      status: 'found',
      board: { id: pick.loc.instance, label, payouts: [] },
      entry: liteEntry(entry),
      trace: [`history: ${label}, rank ${entry.rank}`],
      label: windowLabel(windowId, eventId),
      endedAt: entry.sessions[entry.sessions.length - 1]?.endedAt || undefined,
    });
  }
  return { played: [...byWindow.keys()], results, toRead: [], unmatched };
}

/**
 * Your history in one event, with your own sign-in: one Epic call, or two if
 * Epic wants a team named. `spend` works as for `ownRow` (undefined once the
 * request's budget is used up). An Epic refusal comes back as `error`.
 */
export async function eventHistory(
  client: EpicClient,
  raw: unknown,
  eventId: string,
  accountId: string,
  now: number,
  spend: () => boolean,
): Promise<SyncEventHistory | undefined> {
  const refused = (error: string): SyncEventHistory => ({
    eventId,
    error,
    played: [],
    results: [],
    toRead: [],
    unmatched: 0,
  });
  // Not in the schedule: Epic has stopped listing it, but still keeps your scores (D32).
  const inSchedule = asArr(asObj(raw)?.events).some((e) => str(asObj(e)?.eventId) === eventId);

  const ask = async (team?: string[]): Promise<unknown> => {
    try {
      return await client.getJson(endpoints.playerEventHistory(eventId, accountId, team), 'your history');
    } catch (err) {
      // Sign-in ended, rate limited or Epic down: the whole request stops. Anything else is this event's answer.
      if (!(err instanceof EpicHttpError) || err.status === 401 || err.status === 429 || err.status >= 500) throw err;
      return err;
    }
  };
  if (!spend()) return undefined;
  let body = await ask();
  // Asked without a team, Epic may want one (400): name just you, as for your schedule.
  if (body instanceof EpicHttpError && body.status === 400) {
    if (!spend()) return undefined;
    body = await ask([accountId]);
  }
  if (body instanceof EpicHttpError) return refused(describeError(body));
  if (!Array.isArray(body)) return refused(`200 ${shapeOf(body)}`.slice(0, 300));
  return {
    eventId,
    error: null,
    ...(inSchedule ? historyResults(raw, eventId, body, accountId, now) : pastHistoryResults(eventId, body)),
  };
}
