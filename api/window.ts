// GET /api/window?event=&window=
// The session's boards (main, Ranked Cup tiers, cumulative) with scoring and
// payouts in plain terms. Rules rarely change, so the CDN keeps it an hour.

import { boardInfos, defaultBoard } from '../lib/epic/boards.js';
import { epicClient, type EpicClient } from '../lib/epic/client.js';
import { findWindow, rawSchedule, regionForEvent } from '../lib/epic/schedule.js';
import { epicConfig } from '../lib/config.js';
import { apiError, cdnCacheHeaders, json, toErrorResponse } from '../lib/http.js';
import type { WindowDetail } from '../lib/types.js';
import { isEpicId } from '../lib/validate.js';

export function makeWindowHandler(deps: { client: () => EpicClient; accountId: () => string; now: () => number }) {
  return async function GET(request: Request): Promise<Response> {
    const q = new URL(request.url).searchParams;
    const eventId = q.get('event');
    const windowId = q.get('window');
    if (!isEpicId(eventId) || !isEpicId(windowId))
      return apiError(400, 'bad_request', 'event and window are required.');
    try {
      const raw = await rawSchedule(deps.client(), deps.accountId(), regionForEvent(eventId), deps.now());
      const ref = findWindow(raw, eventId, windowId);
      if (!ref) return apiError(404, 'not_found', "That session isn't in this season's schedule.");
      const boards = boardInfos(raw, eventId, windowId, ref.templateRules);
      const body: WindowDetail = { eventId, windowId, boards, defaultBoard: defaultBoard(boards) };
      return json(body, { headers: cdnCacheHeaders(3600) });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export const GET = makeWindowHandler({
  client: epicClient,
  accountId: () => epicConfig().device.accountId,
  now: Date.now,
});
