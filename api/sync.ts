// Sync with Epic (D30): your own results, read with your own sign-in.
//   POST /api/sync?step=start              -> SyncStart; open the link on epicgames.com and approve
//   POST /api/sync?step=poll&region=       -> SyncPoll; once approved, the sessions Epic lists for you
//   POST /api/sync?step=rows  { sessions } -> SyncRows; your row in each, a few per request
//   POST /api/sync?step=probe { session }  -> SyncProbe; Epic's history for one session, as an outline
//   DELETE /api/sync                       -> ends your Epic session
// The sign-in lives only in a sealed HttpOnly cookie (Path=/api/sync, 15 min):
// nothing is stored on the server, the browser can't read it, and DELETE (sent
// when a sync ends, however it ends) kills the session at Epic at once. Per user,
// so never cached, unlike every other route (D12).

import { killSession, pollDeviceCode, startDeviceCodeLogin } from '../lib/auth/deviceCode.js';
import { exchangeToClient, toEpicToken, type ClientCredentials, type FetchLike } from '../lib/auth/epicToken.js';
import { readCookie } from '../lib/auth/cookie.js';
import { seal, unseal } from '../lib/auth/seal.js';
import { CallLog, EpicClient, epicClient, fixedToken } from '../lib/epic/client.js';
import { endpoints } from '../lib/epic/endpoints.js';
import { EpicHttpError } from '../lib/epic/errors.js';
import { ownRow, playedSessions, probeHistory, type PlayedSession } from '../lib/epic/player.js';
import { asArr, asObj } from '../lib/epic/json.js';
import { rawSchedule, regionForEvent } from '../lib/epic/schedule.js';
import { authConfig, deviceCodeClient, epicConfig } from '../lib/config.js';
import { apiError, json, toErrorResponse } from '../lib/http.js';
import {
  isRegion,
  type SyncPoll,
  type SyncProbe,
  type SyncRowResult,
  type SyncRows,
  type SyncSession,
  type SyncStart,
} from '../lib/types.js';
import { isAccountId, isEpicId } from '../lib/validate.js';

const COOKIE = 'yr_epic';
const PURPOSE = 'epic-sync';
const MAX_AGE_MS = 15 * 60_000;
/** Sessions per rows request, and Epic calls per request, to stay well inside the 30 s limit. */
const MAX_SESSIONS = 8;
const MAX_CALLS = 16;

type SyncState =
  | { phase: 'pending'; deviceCode: string; intervalMs: number }
  | { phase: 'ready'; token: string; accountId: string; displayName: string | null; tokenExpiresAt: number };

interface Deps {
  fetch: FetchLike;
  serviceClient: () => EpicClient;
  serviceAccountId: () => string;
  /** The app's own client (EPIC_CLIENT_ID): the sign-in is exchanged into it, as the service account's is. */
  appClient: () => ClientCredentials;
  codeClient: () => ClientCredentials;
  cookieSecret: () => string;
  now: () => number;
  minGapMs?: number;
}

const cookie = (value: string, maxAgeS: number) =>
  `${COOKIE}=${value}; Path=/api/sync; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeS}`;
const cleared = () => cookie('', 0);

async function readState(request: Request, deps: Deps): Promise<SyncState | undefined> {
  return unseal<SyncState>(readCookie(request.headers.get('cookie'), COOKIE), deps.cookieSecret(), PURPOSE, deps.now());
}

async function setState(state: SyncState, deps: Deps, expiresAt: number): Promise<string> {
  return cookie(
    await seal(state, deps.cookieSecret(), PURPOSE, expiresAt),
    Math.max(1, Math.floor((expiresAt - deps.now()) / 1000)),
  );
}

const signedOut = () =>
  apiError(409, 'sync_signed_out', 'The Epic sign-in for this sync has ended. Start the sync again.');

function userClient(state: Extract<SyncState, { phase: 'ready' }>, deps: Deps): EpicClient {
  const token = { accessToken: state.token, accountId: state.accountId, clientId: '', expiresAt: state.tokenExpiresAt };
  return new EpicClient({ tokens: fixedToken(token), fetch: deps.fetch, minGapMs: deps.minGapMs, log: new CallLog() });
}

function parseSessions(body: unknown, accountId: string): PlayedSession[] | undefined {
  const list = (body as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(list) || !list.length || list.length > MAX_SESSIONS) return undefined;
  const out: PlayedSession[] = [];
  for (const raw of list) {
    const s = raw as Partial<SyncSession> | null;
    if (!s || !isEpicId(s.eventId ?? null) || !isEpicId(s.windowId ?? null)) return undefined;
    const team = Array.isArray(s.team)
      ? s.team.filter((id): id is string => typeof id === 'string' && isAccountId(id))
      : [];
    if (team.length > 4) return undefined;
    out.push({ eventId: s.eventId!, windowId: s.windowId!, team: [...new Set([accountId, ...team])] });
  }
  return out;
}

export function makeSyncHandlers(deps: Deps) {
  async function start(request: Request): Promise<Response> {
    // A new sync replaces an unfinished one: end its sign-in first.
    const previous = await readState(request, deps);
    if (previous?.phase === 'ready') await killSession(deps.fetch, previous.token);
    const login = await startDeviceCodeLogin(deps.fetch, deps.codeClient(), deps.now);
    const expiresAt = Math.min(login.expiresAt, deps.now() + MAX_AGE_MS);
    const body: SyncStart = {
      url: login.verificationUrl,
      code: login.userCode,
      expiresAt: new Date(expiresAt).toISOString(),
      intervalMs: login.intervalMs,
    };
    const state: SyncState = { phase: 'pending', deviceCode: login.deviceCode, intervalMs: login.intervalMs };
    return json(body, { headers: { 'Set-Cookie': await setState(state, deps, expiresAt) } });
  }

  async function poll(request: Request, region: string): Promise<Response> {
    const state = await readState(request, deps);
    if (!state) return signedOut();
    if (state.phase === 'ready') return apiError(409, 'sync_ready', 'Already signed in; read your sessions.');
    let poll;
    try {
      poll = await pollDeviceCode(deps.fetch, deps.codeClient(), state.deviceCode);
    } catch (err) {
      if (!(err instanceof EpicHttpError) || err.status >= 500) throw err;
      const res = apiError(409, 'sync_expired', 'The sign-in link expired or was declined. Start the sync again.');
      res.headers.set('Set-Cookie', cleared());
      return res;
    }
    if (poll.status !== 'approved') {
      const intervalMs = state.intervalMs + (poll.status === 'slow_down' ? 5000 : 0);
      const body: SyncPoll = { status: 'pending', intervalMs };
      return json(body);
    }

    // Approved: move the sign-in into the app's client, as the setup tool does, and end the first session.
    let raw;
    try {
      raw = await exchangeToClient(deps.fetch, poll.token.access_token, deps.appClient());
    } finally {
      await killSession(deps.fetch, poll.token.access_token);
    }
    const token = toEpicToken(raw, deps.appClient().id, deps.now());
    const ready: Extract<SyncState, { phase: 'ready' }> = {
      phase: 'ready',
      token: token.accessToken,
      accountId: token.accountId,
      displayName: typeof raw.displayName === 'string' ? raw.displayName : null,
      tokenExpiresAt: token.expiresAt,
    };
    try {
      if (!isAccountId(ready.accountId)) throw new Error('Epic sent no account for this sign-in.');
      const schedule = await userClient(ready, deps).getJson(
        endpoints.eventsDownload(ready.accountId, {
          region: isRegion(region) ? region : 'NAE',
          platform: 'Windows',
          teamAccountIds: ready.accountId,
        }),
        'your schedule',
      );
      const played = playedSessions(schedule, ready.accountId);
      const player = asObj(asObj(schedule)?.player);
      const body: SyncPoll = {
        status: 'ready',
        accountId: ready.accountId,
        displayName: ready.displayName,
        played: played.length ? played : null,
        epic: {
          playerKeys: Object.keys(player ?? {}).slice(0, 20),
          teams: Object.keys(asObj(player?.teams) ?? {}).length,
          tokens: asArr(player?.tokens).length,
        },
      };
      const expiresAt = Math.min(token.expiresAt, deps.now() + MAX_AGE_MS);
      return json(body, { headers: { 'Set-Cookie': await setState(ready, deps, expiresAt) } });
    } catch (err) {
      // Nothing to keep a sign-in for: end it now.
      await killSession(deps.fetch, ready.token);
      const res = toErrorResponse(err);
      res.headers.set('Set-Cookie', cleared());
      return res;
    }
  }

  async function rows(request: Request): Promise<Response> {
    const state = await readState(request, deps);
    if (!state || state.phase !== 'ready') return signedOut();
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      parsed = undefined;
    }
    const sessions = parseSessions(parsed, state.accountId);
    if (!sessions) return apiError(400, 'bad_sessions', `Send { sessions: [...] }, 1 to ${MAX_SESSIONS} at a time.`);

    const client = userClient(state, deps);
    let calls = 0;
    const spend = () => (calls < MAX_CALLS ? (calls++, true) : false);
    const results: SyncRowResult[] = [];
    const remaining: SyncSession[] = [];
    try {
      for (const s of sessions) {
        // Once the budget runs out, the rest go back for the next request.
        if (remaining.length) {
          remaining.push(s);
          continue;
        }
        const raw = await rawSchedule(
          deps.serviceClient(),
          deps.serviceAccountId(),
          regionForEvent(s.eventId),
          deps.now(),
        );
        const row = await ownRow(client, raw, s, state.accountId, deps.now(), spend);
        if (row) results.push({ eventId: s.eventId, windowId: s.windowId, ...row });
        else remaining.push(s);
      }
    } catch (err) {
      if (err instanceof EpicHttpError && err.status === 401) {
        const res = signedOut();
        res.headers.set('Set-Cookie', cleared());
        return res;
      }
      throw err;
    }
    const body: SyncRows = { results, remaining };
    return json(body);
  }

  async function probe(request: Request): Promise<Response> {
    const state = await readState(request, deps);
    if (!state || state.phase !== 'ready') return signedOut();
    let parsed: { eventId?: unknown; windowId?: unknown } | undefined;
    try {
      parsed = (await request.json()) as typeof parsed;
    } catch {
      parsed = undefined;
    }
    const eventId = typeof parsed?.eventId === 'string' ? parsed.eventId : null;
    const windowId = typeof parsed?.windowId === 'string' ? parsed.windowId : null;
    if (!isEpicId(eventId) || !isEpicId(windowId)) return apiError(400, 'bad_session', 'Send { eventId, windowId }.');
    try {
      const body: SyncProbe = {
        history: await probeHistory(userClient(state, deps), { eventId, windowId }, state.accountId),
      };
      return json(body);
    } catch (err) {
      if (err instanceof EpicHttpError && err.status === 401) return signedOut();
      throw err;
    }
  }

  async function POST(request: Request): Promise<Response> {
    const q = new URL(request.url).searchParams;
    try {
      switch (q.get('step')) {
        case 'start':
          return await start(request);
        case 'poll':
          return await poll(request, q.get('region') ?? '');
        case 'rows':
          return await rows(request);
        case 'probe':
          return await probe(request);
        default:
          return apiError(400, 'bad_step', 'step must be start, poll, rows or probe.');
      }
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      const state = await readState(request, deps);
      if (state?.phase === 'ready') await killSession(deps.fetch, state.token);
    } catch {
      // Clear the cookie regardless.
    }
    return json({ ok: true }, { headers: { 'Set-Cookie': cleared() } });
  }

  return { POST, DELETE };
}

const handlers = makeSyncHandlers({
  fetch: (input, init) => fetch(input, init),
  serviceClient: epicClient,
  serviceAccountId: () => epicConfig().device.accountId,
  appClient: () => epicConfig().client,
  codeClient: () => deviceCodeClient(),
  cookieSecret: () => authConfig().cookieSecret,
  now: Date.now,
});

export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
