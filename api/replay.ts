// GET /api/replay?match=<match ID>
// One tournament game's server replay, read from Epic's replay storage (D31):
// eliminations and knocks, per-player match stats where the replay has them,
// and a count of every kind of event it held. Finished games don't change, so
// the CDN keeps the answer a week; Epic deletes replays after one to two weeks.

import type { FetchLike } from '../lib/auth/epicToken.js';
import { epicAppClient, epicClient, type EpicClient } from '../lib/epic/client.js';
import { EpicHttpError } from '../lib/epic/errors.js';
import { readReplay } from '../lib/epic/replay.js';
import { apiError, cdnCacheHeaders, json, toErrorResponse } from '../lib/http.js';
import type { ReplaySummary } from '../lib/types.js';
import { isMatchId } from '../lib/validate.js';

const WEEK_S = 7 * 24 * 3600;

const gone = () =>
  apiError(404, 'replay_gone', "Epic doesn't have this game's replay any more (it keeps them about one to two weeks).");

export function makeReplayHandler(deps: {
  /** Replay storage answers to an app token (D31); the service account's is tried if it doesn't. */
  client: () => EpicClient;
  fallback?: () => EpicClient;
  fetch: FetchLike;
}) {
  return async function GET(request: Request): Promise<Response> {
    const match = new URL(request.url).searchParams.get('match')?.toLowerCase() ?? null;
    if (!isMatchId(match)) return apiError(400, 'bad_match', 'match must be a 32-character match ID.');
    try {
      let replay: ReplaySummary | undefined;
      try {
        replay = await readReplay(deps.client(), deps.fetch, match);
      } catch (err) {
        if (!(err instanceof EpicHttpError) || ![401, 403].includes(err.status) || !deps.fallback) throw err;
        replay = await readReplay(deps.fallback(), deps.fetch, match);
      }
      if (!replay) return gone();
      return json(replay, { headers: cdnCacheHeaders(replay.live ? 60 : WEEK_S) });
    } catch (err) {
      if (err instanceof EpicHttpError && err.status === 404) return gone();
      return toErrorResponse(err);
    }
  };
}

export const GET = makeReplayHandler({
  client: epicAppClient,
  fallback: epicClient,
  fetch: (input, init) => fetch(input, init),
});
