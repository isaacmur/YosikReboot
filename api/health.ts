// GET /api/health: token status and recent Epic calls for this warm instance.
// Mints a token if there isn't one, so the page also checks the credentials.

import { epicClient, type EpicClient } from '../lib/epic/client.js';
import { ConfigError } from '../lib/config.js';
import { json, toErrorResponse } from '../lib/http.js';
import type { HealthResponse } from '../lib/types.js';

/** Three failures in a row turns the health page red (developer plan). */
export const DOWN_AFTER = 3;
const instanceStartedAt = new Date().toISOString();

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : undefined);

export function makeHealthHandler(deps: { client: () => EpicClient; now: () => number }) {
  return async function GET(): Promise<Response> {
    const base = { checkedAt: new Date(deps.now()).toISOString(), instanceStartedAt };
    let client: EpicClient;
    try {
      client = deps.client();
    } catch (err) {
      if (!(err instanceof ConfigError)) return toErrorResponse(err);
      const body: HealthResponse = {
        ...base,
        status: 'down',
        missingConfig: err.missing,
        token: { consecutiveFailures: 0 },
        upstream: { consecutiveFailures: 0, recent: [] },
      };
      return json(body);
    }
    try {
      await client.ensureToken();
    } catch {
      // Recorded in the token status below.
    }
    const t = client.tokenStatus();
    const upstreamFailures = client.log.consecutiveFailures;
    const worst = Math.max(t.consecutiveFailures, upstreamFailures);
    const body: HealthResponse = {
      ...base,
      status: worst >= DOWN_AFTER ? 'down' : worst > 0 || t.lastError ? 'degraded' : 'ok',
      missingConfig: [],
      token: {
        mintedAt: iso(t.mintedAt),
        expiresAt: iso(t.expiresAt),
        lastError: t.lastError,
        consecutiveFailures: t.consecutiveFailures,
      },
      upstream: { consecutiveFailures: upstreamFailures, recent: client.log.recent() },
    };
    return json(body);
  };
}

export const GET = makeHealthHandler({ client: epicClient, now: Date.now });
