// GET /api/ics?token=<ICS_TOKEN>&region=NAE[&type=FNCS,CASH_CUP]  -> text/calendar
// GET /api/ics (signed in)                                         -> { token } for the subscribe link
// A calendar feed that updates itself (F5): one event per session, from two weeks
// back onward, CDN-cached 15 min like the schedule. Calendar apps can't send the
// session cookie, so the feed URL carries its own secret (ICS_TOKEN), which
// middleware checks before the CDN cache; the route checks it again (D21).

import { feedTokenMatches, isAuthorized, MIN_FEED_TOKEN } from '../lib/auth/cookie.js';
import { cmsCache } from '../lib/epic/cms.js';
import { epicClient, type EpicClient } from '../lib/epic/client.js';
import { normalizeEvents } from '../lib/epic/events.js';
import { rawSchedule } from '../lib/epic/schedule.js';
import { epicConfig, feedToken } from '../lib/config.js';
import { apiError, cdnCacheHeaders, json, toErrorResponse } from '../lib/http.js';
import { calendar, type IcsEvent } from '../lib/ics.js';
import { EVENT_TYPES, isRegion, REGIONS, type CalendarFeed, type EventType } from '../lib/types.js';

export const FEED_PAST_DAYS = 14;
/** Same lifetime as the schedule (/api/events). */
export const FEED_CACHE_S = 900;

interface Deps {
  client: () => EpicClient;
  accountId: () => string;
  now: () => number;
  token: () => string | undefined;
  cookieSecret: () => string | undefined;
}

const isEventType = (t: string): t is EventType => (EVENT_TYPES as readonly string[]).includes(t);

export function makeIcsHandler(deps: Deps) {
  const cmsIndex = cmsCache(deps.now);

  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const q = url.searchParams;
    const given = q.get('token');

    // Signed in, no token: the app asks for the subscribe link. Never cached.
    if (given === null) {
      if (!(await isAuthorized(request, deps.cookieSecret()))) return apiError(401, 'unauthorized', 'Sign in first.');
      const token = deps.token();
      const body: CalendarFeed = { token: token && token.length >= MIN_FEED_TOKEN ? token : null };
      return json(body);
    }

    if (!(await feedTokenMatches(given, deps.token())))
      return apiError(401, 'unauthorized', 'This calendar link is wrong or turned off.');
    const region = q.get('region') ?? 'NAE';
    if (!isRegion(region)) return apiError(400, 'bad_region', `region must be one of ${REGIONS.join(', ')}.`);
    const types = (q.get('type') ?? '').split(',').filter(Boolean);
    if (!types.every(isEventType)) return apiError(400, 'bad_type', `type takes ${EVENT_TYPES.join(', ')}.`);

    try {
      const client = deps.client();
      const now = deps.now();
      const [raw, index] = await Promise.all([rawSchedule(client, deps.accountId(), region, now), cmsIndex(client)]);
      const since = now - FEED_PAST_DAYS * 86_400_000;
      const events: IcsEvent[] = normalizeEvents(raw, index)
        .filter((e) => !types.length || (types as string[]).includes(e.type))
        .flatMap((e) =>
          e.windows
            .filter((w) => Date.parse(w.end) >= since)
            .map((w) => {
              const link = `${url.origin}/events/${encodeURIComponent(e.id)}/${encodeURIComponent(w.id)}`;
              return {
                uid: `${w.id}@yosikreboot`,
                start: w.begin,
                end: w.end,
                summary: e.windows.length > 1 ? `${e.name} · ${w.label}` : e.name,
                description: [...w.requirements, '', `Leaderboard and rules: ${link}`].join('\n').trim(),
                url: link,
                tentative: w.isTBD,
              };
            }),
        )
        .sort((a, b) => a.start.localeCompare(b.start));
      const text = calendar({
        name: `YosikReboot · ${region}`,
        description: `Fortnite competitive sessions visible in ${region}.`,
        now: new Date(now).toISOString(),
        events,
      });
      return new Response(text, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': `inline; filename="yosikreboot-${region}.ics"`,
          ...cdnCacheHeaders(FEED_CACHE_S),
        },
      });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export const GET = makeIcsHandler({
  client: epicClient,
  accountId: () => epicConfig().device.accountId,
  now: Date.now,
  token: feedToken,
  cookieSecret: () => process.env.COOKIE_SECRET,
});
