// GET /api/events?region=NAE
// This season's events visible in one region, normalized. One Epic call per
// region (the response already lists everything visible there, D11), CDN-cached
// 15 min. Session states are computed in the browser from the times, so a cached
// copy never shows a stale "live".

import { indexCms, type CmsIndex } from '../lib/epic/cms.js';
import { epicClient, type EpicClient } from '../lib/epic/client.js';
import { endpoints } from '../lib/epic/endpoints.js';
import { normalizeEvents } from '../lib/epic/events.js';
import { epicConfig } from '../lib/config.js';
import { apiError, cdnCacheHeaders, json, toErrorResponse } from '../lib/http.js';
import { REGIONS, isRegion, type EventsResponse } from '../lib/types.js';

export const SCHEDULE_CACHE_S = 900;
const CMS_TTL_MS = 24 * 60 * 60_000;

interface Deps {
  client: () => EpicClient;
  accountId: () => string;
  now: () => number;
}

export function makeEventsHandler(deps: Deps) {
  let cms: { at: number; index: CmsIndex } | undefined;

  /** Display data is decoration: on failure keep the last copy (or none) rather than fail the schedule. */
  async function cmsIndex(client: EpicClient): Promise<CmsIndex> {
    if (cms && deps.now() - cms.at < CMS_TTL_MS) return cms.index;
    try {
      cms = {
        at: deps.now(),
        index: indexCms(await client.getJson(endpoints.tournamentInfo(), 'cms', { auth: false })),
      };
    } catch {
      return cms?.index ?? new Map();
    }
    return cms.index;
  }

  return async function GET(request: Request): Promise<Response> {
    const region = new URL(request.url).searchParams.get('region');
    if (!isRegion(region)) return apiError(400, 'bad_region', `region must be one of ${REGIONS.join(', ')}.`);
    try {
      const client = deps.client();
      const accountId = deps.accountId();
      const [raw, index] = await Promise.all([
        client.getJson(
          endpoints.eventsDownload(accountId, { region, platform: 'Windows', teamAccountIds: accountId }),
          `events ${region}`,
        ),
        cmsIndex(client),
      ]);
      const body: EventsResponse = {
        region,
        fetchedAt: new Date(deps.now()).toISOString(),
        events: normalizeEvents(raw, index),
      };
      return json(body, { headers: cdnCacheHeaders(SCHEDULE_CACHE_S) });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export const GET = makeEventsHandler({
  client: epicClient,
  accountId: () => epicConfig().device.accountId,
  now: Date.now,
});
