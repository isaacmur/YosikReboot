// The only way API routes talk to Epic: adds the token, spaces calls out,
// retries once after a 401 with a fresh token, and logs every call for /api/health.

import { EpicTokenManager, readJson, type EpicToken, type FetchLike, type TokenStatus } from '../auth/epicToken.js';
import { epicConfig } from '../config.js';
import { EpicHttpError, parseEpicError } from './errors.js';

export interface CallLogEntry {
  at: string;
  label: string;
  status: number;
  ms: number;
  errorCode?: string;
}

/** Recent upstream calls, newest first. Per warm function instance, not global. */
export class CallLog {
  private readonly entries: CallLogEntry[] = [];
  private failures = 0;

  constructor(private readonly max = 20) {}

  add(e: CallLogEntry): void {
    this.entries.unshift(e);
    this.entries.length = Math.min(this.entries.length, this.max);
    this.failures = e.status >= 200 && e.status < 400 ? 0 : this.failures + 1;
  }

  recent(): CallLogEntry[] {
    return [...this.entries];
  }

  /** Upstream calls that failed in a row (network error, 4xx or 5xx). */
  get consecutiveFailures(): number {
    return this.failures;
  }
}

/** Where a client gets its access token: the service account's device auth, or a fixed sign-in. */
export interface TokenSource {
  get(): Promise<EpicToken>;
  invalidate(): void;
  status(): TokenStatus;
}

/** A token that's used as is and never re-minted (your own sign-in during a sync, D30). */
export function fixedToken(token: EpicToken): TokenSource {
  return { get: async () => token, invalidate: () => {}, status: () => ({ consecutiveFailures: 0 }) };
}

export interface EpicClientOptions {
  tokens: TokenSource;
  fetch?: FetchLike;
  /**
   * Minimum gap between calls from this instance (politeness, F37). 250 ms lets a
   * board scan's parallel page reads through at about four a second (D26).
   */
  minGapMs?: number;
  log?: CallLog;
  sleep?: (ms: number) => Promise<void>;
}

export class EpicClient {
  readonly log: CallLog;
  private readonly fetchImpl: FetchLike;
  private readonly minGap: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextSlot = 0;

  constructor(private readonly opts: EpicClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.minGap = opts.minGapMs ?? 250;
    this.log = opts.log ?? new CallLog();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  tokenStatus(): TokenStatus {
    return this.opts.tokens.status();
  }

  /** Mints a token if there isn't a valid one (used by /api/health). */
  async ensureToken(): Promise<void> {
    await this.opts.tokens.get();
  }

  /** GET a JSON document. `auth: false` for public endpoints (the CMS). */
  async getJson(url: string, label: string, o: { auth?: boolean } = {}): Promise<unknown> {
    const auth = o.auth !== false;
    let res = await this.attempt(url, label, auth);
    if (auth && res.status === 401) {
      this.opts.tokens.invalidate();
      res = await this.attempt(url, `${label} (retry)`, auth);
    }
    const body = await readJson(res);
    if (!res.ok) {
      const { errorCode, errorMessage } = parseEpicError(body);
      throw new EpicHttpError(res.status, url, errorCode, errorMessage);
    }
    return body;
  }

  private async attempt(url: string, label: string, auth: boolean): Promise<Response> {
    // Reserve the next free slot, so concurrent callers queue up minGap apart.
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minGap;
    if (slot > now) await this.sleep(slot - now);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth) headers.Authorization = `bearer ${(await this.opts.tokens.get()).accessToken}`;
    const started = Date.now();
    try {
      const res = await this.fetchImpl(url, { headers });
      const entry: CallLogEntry = {
        at: new Date(started).toISOString(),
        label,
        status: res.status,
        ms: Date.now() - started,
      };
      if (!res.ok) entry.errorCode = parseEpicError(await readJson(res.clone())).errorCode;
      this.log.add(entry);
      return res;
    } catch (err) {
      this.log.add({
        at: new Date(started).toISOString(),
        label,
        status: 0,
        ms: Date.now() - started,
        errorCode: 'network',
      });
      throw err;
    }
  }
}

let shared: EpicClient | undefined;

/** One client per warm function instance, so the token and call log survive between requests. */
export function epicClient(): EpicClient {
  shared ??= new EpicClient({ tokens: new EpicTokenManager(epicConfig()) });
  return shared;
}
