// Response helpers shared by the API routes.

import { ConfigError } from './config.js';
import { EpicHttpError } from './epic/errors.js';

export const NO_STORE = 'no-store';

/**
 * Cached by Vercel's CDN only: `Vercel-CDN-Cache-Control` is consumed by Vercel and
 * never reaches the browser, and browsers are told not to store the response, so
 * signing out takes effect at once and every browser request passes the gate.
 */
export function cdnCacheHeaders(seconds: number, staleSeconds = Math.min(seconds, 300)): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'Vercel-CDN-Cache-Control': `max-age=${seconds}, stale-while-revalidate=${staleSeconds}`,
  };
}

/** JSON response; uncached unless `headers` says otherwise. */
export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': NO_STORE, ...init.headers },
  });
}

export interface ApiErrorBody {
  error: { code: string; message: string; upstreamStatus?: number };
}

/** Errors are never cached, so a failure can't stick around for a cache window. */
export function apiError(status: number, code: string, message: string, upstreamStatus?: number): Response {
  const body: ApiErrorBody = { error: { code, message, ...(upstreamStatus ? { upstreamStatus } : {}) } };
  return json(body, { status });
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof ConfigError) return apiError(500, 'config', err.message);
  if (err instanceof EpicHttpError) {
    if (err.status === 429)
      return apiError(503, 'epic_rate_limited', 'Epic is rate limiting requests; try again shortly.', 429);
    if (err.status === 401 || err.status === 403) {
      return apiError(502, 'epic_auth', 'Epic rejected the service account token.', err.status);
    }
    if (err.status === 404) return apiError(404, 'not_found', 'Epic has no such event or window.', 404);
    return apiError(502, 'epic_upstream', `Epic responded ${err.status}.`, err.status);
  }
  if (err instanceof TypeError) return apiError(502, 'epic_unreachable', 'Could not reach Epic.');
  return apiError(500, 'internal', 'Unexpected server error.');
}
