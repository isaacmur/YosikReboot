// GET /api/player?name=<Epic display name>  -> { id, displayName }
// GET /api/player?ids=<id>,<id>,…            -> [{ id, displayName }] (max 100)
// For adding follows by name and refreshing their names. Cached an hour.

import { lookupByName, resolveNames } from '../lib/epic/accounts.js';
import { epicClient, type EpicClient } from '../lib/epic/client.js';
import { BULK_ACCOUNT_LIMIT } from '../lib/epic/endpoints.js';
import { EpicHttpError } from '../lib/epic/errors.js';
import { apiError, cdnCacheHeaders, json, toErrorResponse } from '../lib/http.js';
import type { PlayerLookup } from '../lib/types.js';
import { isAccountId, isDisplayName } from '../lib/validate.js';

export function makePlayerHandler(deps: { client: () => EpicClient; now: () => number }) {
  return async function GET(request: Request): Promise<Response> {
    const q = new URL(request.url).searchParams;
    const name = q.get('name');
    const ids = q.get('ids');
    try {
      if (name !== null) {
        if (!isDisplayName(name.trim())) return apiError(400, 'bad_name', 'Enter an Epic display name.');
        try {
          const found: PlayerLookup = await lookupByName(deps.client(), name.trim());
          return json(found, { headers: cdnCacheHeaders(3600) });
        } catch (err) {
          if (err instanceof EpicHttpError && err.status === 404) {
            return apiError(404, 'player_not_found', `No Epic account is called "${name.trim()}".`);
          }
          throw err;
        }
      }
      if (ids !== null) {
        const list = [...new Set(ids.split(',').filter(Boolean))];
        if (!list.length || list.length > BULK_ACCOUNT_LIMIT || !list.every(isAccountId)) {
          return apiError(400, 'bad_ids', `ids takes 1-${BULK_ACCOUNT_LIMIT} account IDs.`);
        }
        const names = await resolveNames(deps.client(), list, deps.now());
        const body: PlayerLookup[] = list.flatMap((id) => (names.has(id) ? [{ id, displayName: names.get(id)! }] : []));
        return json(body, { headers: cdnCacheHeaders(3600) });
      }
      return apiError(400, 'bad_request', 'Pass name= or ids=.');
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export const GET = makePlayerHandler({ client: epicClient, now: Date.now });
