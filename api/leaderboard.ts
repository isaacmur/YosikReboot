// GET /api/leaderboard?event=&window=[&board=][&page=0][&lite=1]
// One page of one board, normalized, with display names. Cached on the CDN by
// window state: live 30 s, wrapping up 5 min, final 24 h. `board=cumulative`
// sums the event's session boards (top 300 of each, D7). `lite=1` skips names
// and match details, for page scans that look for followed players.

import { boardInfos, boardLabel, boardRules, defaultBoard, isFetchable, windowLocations } from '../lib/epic/boards.js';
import { epicClient, type EpicClient } from '../lib/epic/client.js';
import { resolveNames } from '../lib/epic/accounts.js';
import { endpoints } from '../lib/epic/endpoints.js';
import { asArr, asObj, num, str } from '../lib/epic/json.js';
import { liteEntry, mergeCumulative, normalizeEntries } from '../lib/epic/leaderboard.js';
import { findWindow, rawSchedule, regionForEvent } from '../lib/epic/schedule.js';
import { epicConfig } from '../lib/config.js';
import { apiError, cdnCacheHeaders, json, toErrorResponse } from '../lib/http.js';
import { cacheSecondsFor, windowState } from '../lib/status.js';
import type { Entry, LeaderboardPage, WindowState } from '../lib/types.js';
import { isEpicId } from '../lib/validate.js';

/** Pages summed per session for a cumulative board. */
export const CUMULATIVE_PAGES = 3;

interface Deps {
  client: () => EpicClient;
  accountId: () => string;
  now: () => number;
}

function timesOf(w: Record<string, unknown>) {
  return { begin: str(w.beginTime) ?? '', end: str(w.endTime) ?? '', payoutDelayMin: num(w.payoutDelay) ?? null };
}

/** The most active state among several sessions decides how long a combined board is cached. */
function combinedState(states: WindowState[]): WindowState {
  for (const s of ['live', 'wrapping', 'upcoming'] as const) if (states.includes(s)) return s;
  return 'final';
}

export function makeLeaderboardHandler(deps: Deps) {
  return async function GET(request: Request): Promise<Response> {
    const q = new URL(request.url).searchParams;
    const eventId = q.get('event');
    const windowId = q.get('window');
    const boardParam = q.get('board');
    const page = Number(q.get('page') ?? 0);
    const lite = q.get('lite') === '1';
    if (!isEpicId(eventId) || !isEpicId(windowId))
      return apiError(400, 'bad_request', 'event and window are required.');
    if (boardParam !== null && !isEpicId(boardParam)) return apiError(400, 'bad_board', 'Unknown board.');
    if (!Number.isInteger(page) || page < 0 || page > 99) return apiError(400, 'bad_page', 'page must be 0-99.');

    try {
      const client = deps.client();
      const accountId = deps.accountId();
      const now = deps.now();
      const raw = await rawSchedule(client, accountId, regionForEvent(eventId), now);
      const ref = findWindow(raw, eventId, windowId);
      if (!ref) return apiError(404, 'not_found', "That session isn't in this season's schedule.");

      const boards = boardInfos(raw, eventId, windowId, ref.templateRules);
      const boardId = boardParam ?? defaultBoard(boards);
      let entries: Entry[];
      let totalPages: number;
      let approximate: boolean | undefined;
      let state = windowState(timesOf(ref.window), new Date(now));

      if (boardId === 'cumulative') {
        const cumKey = windowLocations(raw, eventId, windowId).find((l) => l.group === 'cumulative')?.key;
        if (!cumKey) return apiError(400, 'bad_board', 'This session has no cumulative standings.');
        const siblings = asArr(ref.event.eventWindows)
          .map(asObj)
          .filter((w): w is Record<string, unknown> => !!w)
          .filter((w) => windowLocations(raw, eventId, str(w.eventWindowId) ?? '').some((l) => l.key === cumKey));
        const states = siblings.map((w) => windowState(timesOf(w), new Date(now)));
        state = combinedState(states);
        const boardsToSum: Entry[][] = [];
        approximate = false;
        for (const [i, w] of siblings.entries()) {
          if (states[i] === 'upcoming') continue;
          const id = str(w.eventWindowId)!;
          const loc = windowLocations(raw, eventId, id)[0]!;
          const rules = boardRules(raw, loc, findWindow(raw, eventId, id)?.templateRules);
          for (let p = 0; p < CUMULATIVE_PAGES; p++) {
            const body = asObj(
              await client.getJson(
                endpoints.leaderboard(loc.group, loc.instance, accountId, { page: p }),
                `cumulative ${id} p${p}`,
              ),
            );
            boardsToSum.push(normalizeEntries(body, rules));
            const pages = num(body?.totalPages) ?? 0;
            if (p === CUMULATIVE_PAGES - 1 && pages > CUMULATIVE_PAGES) approximate = true;
            if (p + 1 >= pages) break;
          }
        }
        entries = mergeCumulative(boardsToSum).slice(0, CUMULATIVE_PAGES * 100);
        totalPages = 1;
      } else {
        const loc = windowLocations(raw, eventId, windowId).find((l) => l.instance === boardId && isFetchable(l));
        if (!loc) return apiError(400, 'bad_board', 'Unknown board for this session.');
        const body = asObj(
          await client.getJson(
            endpoints.leaderboard(loc.group, loc.instance, accountId, { page }),
            `board ${boardLabel(loc, windowId)} p${page}`,
          ),
        );
        entries = normalizeEntries(
          body,
          boardRules(raw, loc, loc.instance === windowId ? ref.templateRules : undefined),
        );
        totalPages = num(body?.totalPages) ?? 0;
      }

      if (lite) entries = entries.map(liteEntry);
      else {
        const names = await resolveNames(
          client,
          entries.flatMap((e) => e.members.map((m) => m.id)),
          now,
        );
        for (const e of entries) for (const m of e.members) m.name = names.get(m.id);
      }

      const body: LeaderboardPage = {
        eventId,
        windowId,
        board: boardId,
        page: boardId === 'cumulative' ? 0 : page,
        totalPages,
        fetchedAt: new Date(now).toISOString(),
        ...(approximate !== undefined ? { approximate } : {}),
        entries,
      };
      return json(body, { headers: cdnCacheHeaders(cacheSecondsFor(state)) });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export const GET = makeLeaderboardHandler({
  client: epicClient,
  accountId: () => epicConfig().device.accountId,
  now: Date.now,
});
