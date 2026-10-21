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

export type OwnRow =
  | { status: 'found'; board: Pick<BoardInfo, 'id' | 'label' | 'payouts'>; entry: Entry }
  | { status: 'not_found' | 'not_final' | 'unknown' };

/**
 * Your row in one session: its scored boards (Ranked Cup tiers top first), each
 * filtered to your team, until it turns up. `spend` is called before each Epic
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
  if (!ref) return { status: 'unknown' };
  const times = { begin: str(ref.window.beginTime) ?? '', end: str(ref.window.endTime) ?? '' };
  if (windowState({ ...times, payoutDelayMin: num(ref.window.payoutDelay) ?? null }, new Date(now)) !== 'final')
    return { status: 'not_final' };
  const all = boardInfos(raw, s.eventId, s.windowId, ref.templateRules).filter((b) => !b.computed);
  const scored = all.filter((b) => b.hasPoints);
  const boards = scored.length ? [...scored].reverse() : all;
  for (const b of boards) {
    const loc = windowLocations(raw, s.eventId, s.windowId).find((l) => l.instance === b.id && isFetchable(l));
    if (!loc) continue;
    if (!spend()) return undefined;
    let body: Record<string, unknown> | undefined;
    try {
      body = asObj(
        await client.getJson(
          endpoints.leaderboard(loc.group, loc.instance, accountId, { teamAccountIds: s.team }),
          `your row ${b.label}`,
        ),
      );
    } catch (err) {
      // Not your team on this board (400) or no such board (404): try the next one.
      if (err instanceof EpicHttpError && (err.status === 400 || err.status === 404)) continue;
      throw err;
    }
    const rules = boardRules(raw, loc, loc.instance === s.windowId ? ref.templateRules : undefined);
    const entry = normalizeEntries(body, rules).find((e) => e.members.some((m) => m.id === accountId));
    if (entry)
      return { status: 'found', board: { id: b.id, label: b.label, payouts: b.payouts }, entry: liteEntry(entry) };
  }
  return { status: 'not_found' };
}
