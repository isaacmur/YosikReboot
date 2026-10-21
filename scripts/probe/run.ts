import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  exchangeToClient,
  mintFromDeviceAuth,
  readJson,
  type ClientCredentials,
  type DeviceAuth,
  type FetchLike,
  type TokenResponse,
} from '../../lib/auth/epicToken';
import { BULK_ACCOUNT_LIMIT, endpoints } from '../../lib/epic/endpoints';
import { parseEpicError } from '../../lib/epic/errors';
import { REGIONS, type Region } from '../../lib/types';
import { sanitizeAccount, sanitizeToken, scrub } from './scrub';
import { asArr, asObj, listWindows, pickSampleWindows, type ProbeWindow, type SampleKind } from './select';

export interface ProbeConfig {
  client: ClientCredentials;
  device: DeviceAuth;
  exchangeClient?: ClientCredentials;
  /** Display name for the name -> ID lookup; defaults to the service account's own. */
  displayName?: string;
}

export interface ProbeOptions {
  /** Without credentials only the unauthenticated checks run. */
  config?: ProbeConfig;
  outDir: string;
  fetch?: FetchLike;
  now?: () => Date;
  regions?: readonly Region[];
  platform?: string;
  /** Minimum gap between Epic calls. */
  spacingMs?: number;
  /** Number of back-to-back calls for the rate-limit test; 0 skips it. */
  rateTest?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface CallRecord {
  step: string;
  method: string;
  url: string;
  status: number;
  ms: number;
  bytes?: number;
  file?: string;
  errorCode?: string;
  error?: string;
  headers?: Record<string, string>;
}

export interface ProbeReport {
  startedAt: string;
  finishedAt?: string;
  authenticated: boolean;
  serviceAccountId?: string;
  token?: {
    clientId?: string;
    exchanged: boolean;
    expiresIn?: number;
    expiresAt?: string;
    tokenType?: string;
    hasRefreshToken: boolean;
  };
  samples: Partial<Record<SampleKind, ProbeWindow>>;
  /** Team the filtered leaderboard request asked for. */
  filteredTarget?: string[];
  rateTest?: { requests: number; statuses: number[]; first429At?: number; retryAfter?: string };
  calls: CallRecord[];
  notes: string[];
}

/** Used for unauthenticated calls when no service account is configured. */
const PLACEHOLDER_ACCOUNT_ID = '00000000000000000000000000000000';
const MISSING_WINDOW_ID = 'YosikReboot_Probe_DoesNotExist';
const MAX_URL_IN_REPORT = 300;

function pickHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    if (/^(content-type|cache-control|age|etag|retry-after)$|rate|limit/i.test(key)) out[key] = value;
  });
  return out;
}

function shortUrl(url: string): string {
  return url.length > MAX_URL_IN_REPORT ? `${url.slice(0, MAX_URL_IN_REPORT)}…` : url;
}

/** Node's fetch hides the useful part (DNS, TLS, proxy refusal) in `cause`. */
export function message(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined;
  return detail && detail !== err.message ? `${err.message} (${detail})` : err.message;
}

export async function runProbe(opts: ProbeOptions): Promise<ProbeReport> {
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacing = opts.spacingMs ?? 1000;
  const regions = opts.regions ?? REGIONS;
  const platform = opts.platform ?? 'Windows';
  const log = opts.log ?? (() => {});
  const { config, outDir } = opts;

  await mkdir(outDir, { recursive: true });

  const secrets: (string | undefined)[] = [
    config?.client.secret,
    config?.exchangeClient?.secret,
    config?.device.secret,
    config?.device.deviceId,
  ];
  const report: ProbeReport = {
    startedAt: now().toISOString(),
    authenticated: false,
    samples: {},
    calls: [],
    notes: [],
  };
  let accessToken: string | undefined;
  let lastCallAt = 0;

  const save = async (file: string, body: unknown) => {
    await writeFile(join(outDir, file), `${JSON.stringify(scrub(body, secrets), null, 2)}\n`);
  };

  async function space() {
    const wait = lastCallAt + spacing - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  }

  /** One Epic call: spaced, recorded, and optionally saved (scrubbed) as a fixture. */
  async function call(
    step: string,
    url: string,
    o: { file?: string; auth?: boolean; method?: string; spaced?: boolean; sanitize?: (body: unknown) => unknown } = {},
  ): Promise<{ status: number; body: unknown; headers?: Headers }> {
    const method = o.method ?? 'GET';
    if (o.spaced !== false) await space();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.auth !== false && accessToken) headers.Authorization = `bearer ${accessToken}`;
    const started = Date.now();
    try {
      const res = await fetchImpl(url, { method, headers });
      const text = await res.text();
      let body: unknown = undefined;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      const rec: CallRecord = {
        step,
        method,
        url: shortUrl(url),
        status: res.status,
        ms: Date.now() - started,
        bytes: Buffer.byteLength(text),
        headers: pickHeaders(res.headers),
      };
      if (!res.ok) rec.errorCode = parseEpicError(body).errorCode;
      if (o.file && body !== undefined) {
        await save(o.file, o.sanitize ? o.sanitize(body) : body);
        rec.file = o.file;
      }
      report.calls.push(rec);
      log(`${String(res.status).padStart(3)} ${step}${rec.file ? ` -> ${rec.file}` : ''}`);
      return { status: res.status, body, headers: res.headers };
    } catch (err) {
      report.calls.push({ step, method, url: shortUrl(url), status: 0, ms: Date.now() - started, error: message(err) });
      log(`ERR ${step}: ${message(err)}`);
      return { status: 0, body: undefined };
    }
  }

  /** Records token-endpoint calls without ever writing their bodies. */
  const recordingFetch =
    (step: string): FetchLike =>
    async (input, init) => {
      await space();
      const started = Date.now();
      try {
        const res = await fetchImpl(input, init);
        const rec: CallRecord = {
          step,
          method: init?.method ?? 'GET',
          url: shortUrl(input),
          status: res.status,
          ms: Date.now() - started,
          headers: pickHeaders(res.headers),
        };
        // Error bodies carry no token, so their errorCode is safe to keep.
        if (!res.ok) rec.errorCode = parseEpicError(await readJson(res.clone())).errorCode;
        report.calls.push(rec);
        log(`${String(res.status).padStart(3)} ${step}`);
        return res;
      } catch (err) {
        report.calls.push({ step, method: init?.method ?? 'GET', url: shortUrl(input), status: 0, ms: Date.now() - started, error: message(err) });
        log(`ERR ${step}: ${message(err)}`);
        throw err;
      }
    };

  const finish = async () => {
    report.finishedAt = now().toISOString();
    await save('probe-report.json', report);
    return report;
  };

  // --- Unauthenticated checks -------------------------------------------------
  await call('cms.tournamentinformation', endpoints.tournamentInfo(), {
    auth: false,
    file: 'cms-tournamentinformation.json',
  });
  await call(
    'events.download.noauth',
    endpoints.eventsDownload(config?.device.accountId ?? PLACEHOLDER_ACCOUNT_ID, { region: regions[0], platform }),
    { auth: false, file: 'error-noauth-events.json' },
  );

  if (!config) {
    report.notes.push('No credentials configured: only unauthenticated checks ran.');
    return finish();
  }

  // --- Token --------------------------------------------------------------------
  let raw: TokenResponse;
  try {
    raw = await mintFromDeviceAuth(recordingFetch('oauth.device_auth'), config.client, config.device);
    if (config.exchangeClient) {
      secrets.push(raw.access_token);
      raw = await exchangeToClient(recordingFetch('oauth.exchange'), raw.access_token, config.exchangeClient);
    }
  } catch (err) {
    report.notes.push(`Token mint failed: ${message(err)}. Stopping; nothing else can be probed.`);
    return finish();
  }
  accessToken = raw.access_token;
  secrets.push(raw.access_token, typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined);
  report.authenticated = true;
  const accountId = raw.account_id ?? config.device.accountId;
  report.serviceAccountId = accountId;
  report.token = {
    clientId: raw.client_id,
    exchanged: !!config.exchangeClient,
    expiresIn: typeof raw.expires_in === 'number' ? raw.expires_in : undefined,
    expiresAt: raw.expires_at,
    tokenType: typeof raw.token_type === 'string' ? raw.token_type : undefined,
    hasRefreshToken: typeof raw.refresh_token === 'string',
  };
  await save('oauth-token.json', sanitizeToken(raw));

  // --- Schedule -----------------------------------------------------------------
  const windows = new Map<string, ProbeWindow>();
  for (const region of regions) {
    const { body } = await call(
      `events.download.${region}`,
      endpoints.eventsDownload(accountId, { region, platform, teamAccountIds: accountId }),
      { file: `events-download-${region}.json` },
    );
    for (const w of listWindows(body)) windows.set(w.windowId, w);
  }
  await call('events.download.noregion', endpoints.eventsDownload(accountId, { platform, teamAccountIds: accountId }), {
    file: 'events-download-noregion.json',
  });
  await call(
    `events.data.${regions[0]}`,
    endpoints.eventsData(accountId, { region: regions[0], platform, showPastEvents: true }),
    { file: `events-data-${regions[0]}.json` },
  );

  if (windows.size === 0) {
    report.notes.push('No windows could be read from the events responses; leaderboard steps skipped.');
    return finish();
  }

  const samples = pickSampleWindows([...windows.values()], now());
  report.samples = samples;
  for (const kind of ['upcoming', 'live', 'wrapping', 'final', 'duos'] as const) {
    if (!samples[kind]) report.notes.push(`No ${kind} window this run; capture again when one exists.`);
  }

  // --- Leaderboards -------------------------------------------------------------
  const lb = (w: ProbeWindow, p: Parameters<typeof endpoints.leaderboard>[3] = {}) =>
    endpoints.leaderboard(w.eventId, w.windowId, accountId, p);

  for (const kind of ['upcoming', 'live', 'wrapping', 'duos'] as const) {
    const w = samples[kind];
    if (!w) continue;
    await call(`leaderboard.${kind}.p0`, lb(w), { file: `leaderboard-${kind}-p0.json` });
    if (kind === 'live') {
      await call('leaderboard.live.p0.liveSessions', lb(w, { showLiveSessions: true }), {
        file: 'leaderboard-live-p0-liveSessions.json',
      });
    }
  }

  const final = samples.final;
  let leaderboardIds: string[] = [];
  if (final) {
    const p0 = await call('leaderboard.final.p0', lb(final), { file: 'leaderboard-final-p0.json' });
    const entries = asArr(asObj(p0.body)?.entries);
    const teams = entries.map((e) => asArr(asObj(e)?.teamAccountIds).filter((x): x is string => typeof x === 'string'));
    leaderboardIds = [...new Set(teams.flat())];
    const totalPages = asObj(p0.body)?.totalPages;

    await call('leaderboard.final.p1', lb(final, { page: 1 }), { file: 'leaderboard-final-p1.json' });
    if (typeof totalPages === 'number' && totalPages > 2) {
      await call('leaderboard.final.last', lb(final, { page: totalPages - 1 }), { file: 'leaderboard-final-last.json' });
    }
    // Can one team's row be fetched directly? Use a team from the middle of page 0.
    const target = teams[Math.floor(teams.length / 2)];
    if (target?.length) {
      await call('leaderboard.final.filtered', lb(final, { teamAccountIds: target }), {
        file: 'leaderboard-final-filtered.json',
      });
      report.filteredTarget = target;
    }

    await call('history.window.final', endpoints.windowHistory(final.eventId, final.windowId), {
      file: 'history-window-final.json',
    });
    const member = target?.[0] ?? accountId;
    await call('history.player.final', endpoints.playerWindowHistory(final.eventId, final.windowId, member), {
      file: 'history-player-final.json',
    });
    await call('leaderboard.missing', endpoints.leaderboard(final.eventId, MISSING_WINDOW_ID, accountId), {
      file: 'error-missing-window.json',
    });
  }

  // --- Accounts -----------------------------------------------------------------
  if (leaderboardIds.length) {
    const batch = leaderboardIds.slice(0, BULK_ACCOUNT_LIMIT);
    await call(`accounts.bulk.${batch.length}`, endpoints.accountsById(batch), {
      file: 'accounts-bulk.json',
      sanitize: sanitizeAccount,
    });
    if (leaderboardIds.length > BULK_ACCOUNT_LIMIT) {
      const over = leaderboardIds.slice(0, BULK_ACCOUNT_LIMIT + 1);
      await call(`accounts.bulk.${over.length}`, endpoints.accountsByIdUnchecked(over), {
        file: 'accounts-bulk-over-limit.json',
        sanitize: sanitizeAccount,
      });
    } else {
      report.notes.push(`Only ${leaderboardIds.length} IDs on the final board; bulk limit above ${BULK_ACCOUNT_LIMIT} not tested.`);
    }
  }
  const name = config.displayName ?? (typeof raw.displayName === 'string' ? raw.displayName : undefined);
  if (name) {
    await call('accounts.byName', endpoints.accountByName(name), { file: 'account-by-name.json', sanitize: sanitizeAccount });
  }

  await call('players.tokens', endpoints.playerTokens([accountId]), { file: 'player-tokens.json' });

  // --- Rate limit (opt-in) ------------------------------------------------------
  const n = opts.rateTest ?? 0;
  if (n > 0) {
    const url = endpoints.eventsDownload(accountId, { region: regions[0], platform, teamAccountIds: accountId });
    const statuses: number[] = [];
    let retryAfter: string | undefined;
    for (let i = 0; i < n; i++) {
      const r = await call(`rate.${i + 1}`, url, { spaced: false });
      statuses.push(r.status);
      if (r.status === 429) {
        retryAfter = r.headers?.get('retry-after') ?? undefined;
        break;
      }
    }
    const first = statuses.indexOf(429);
    report.rateTest = { requests: statuses.length, statuses, first429At: first === -1 ? undefined : first + 1, retryAfter };
  }

  return finish();
}
