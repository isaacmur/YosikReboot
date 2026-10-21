// Your own results, read with your own sign-in during a sync (D30). Epic answers
// these only for the signed-in account (D10): the `player` part of your schedule
// download lists the sessions you have a team in, and a board filtered to your
// team (`teamAccountIds=`) returns just your row.

import { isAccountId } from '../validate.js';
import { boardInfos, boardRules, isFetchable, windowLocations } from './boards.js';
import type { EpicClient } from './client.js';
import { endpoints } from './endpoints.js';
import { EpicHttpError } from './errors.js';
import { asObj, num, str } from './json.js';
import { liteEntry, normalizeEntries } from './leaderboard.js';
import { findWindow } from './schedule.js';
import { windowState } from '../status.js';
import type { BoardInfo, Entry } from '../types.js';

export interface PlayedSession {
  eventId: string;
  windowId: string;
  /** Your team's account IDs, you included. */
  team: string[];
}

/**
 * Sessions Epic lists a team for you in: `player.teams`, keyed
 * "<eventId>:<windowId>" with the team's account IDs. Unverified against a real
 * player until the first sync: the service account's list is empty.
 */
export function playedSessions(rawSchedule: unknown, accountId: string): PlayedSession[] {
  const teams = asObj(asObj(asObj(rawSchedule)?.player)?.teams);
  if (!teams) return [];
  const out: PlayedSession[] = [];
  for (const [key, ids] of Object.entries(teams)) {
    const [eventId, windowId, extra] = key.split(':');
    if (!eventId || !windowId || extra !== undefined) continue;
    const members = (Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === 'string');
    out.push({ eventId, windowId, team: [...new Set([accountId, ...members.filter(isAccountId)])] });
  }
  return out;
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
  const times = { begin: str(ref.window.beginTime) ?? '', end: str(ref.window.endTime) ?? '' };
  if (windowState({ ...times, payoutDelayMin: num(ref.window.payoutDelay) ?? null }, new Date(now)) !== 'final')
    return { status: 'not_final', trace: ['results not final yet'] };
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

/**
 * Epic's per-player history for one session, asked once with your own sign-in.
 * Phase 0 got 403 asking about another account; this checks whether your own
 * works, and reports only the response's outline (D30).
 */
export async function probeHistory(
  client: EpicClient,
  s: { eventId: string; windowId: string },
  accountId: string,
): Promise<string> {
  try {
    const body = await client.getJson(endpoints.playerWindowHistory(s.eventId, s.windowId, accountId), 'your history');
    return `200 ${shapeOf(body)}`.slice(0, 600);
  } catch (err) {
    if (err instanceof EpicHttpError) return describeError(err);
    throw err;
  }
}
