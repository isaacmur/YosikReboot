import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../lib/auth/epicToken';
import { analyze, loadRun, renderAnalysis, shapeOf } from '../scripts/probe/analyze';
import { message, runProbe, type ProbeConfig } from '../scripts/probe/run';
import { ACCESS_TOKEN, fakeEpic, REFRESH_TOKEN, SERVICE_ACCOUNT, type FakeEpicOptions } from './helpers/fakeEpic';

const now = new Date('2026-10-21T18:00:00Z');
const config: ProbeConfig = {
  client: { id: 'client123', secret: 'client-secret-xyz' },
  device: { accountId: SERVICE_ACCOUNT, deviceId: 'device-id-abcdef', secret: 'device-secret-abcdef' },
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yr-probe-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function probe(fake: Partial<FakeEpicOptions> = {}, extra: Partial<Parameters<typeof runProbe>[0]> = {}) {
  const epic = fakeEpic({ now, ...fake });
  const report = await runProbe({
    config,
    outDir: dir,
    fetch: epic.fetch,
    now: () => now,
    regions: ['NAE', 'EU'],
    spacingMs: 0,
    ...extra,
  });
  const run = await loadRun(dir);
  const findings = analyze(run.report, run.files);
  const byId = (id: string) => findings.find((f) => f.id === id)!;
  return { epic, report, run, findings, byId };
}

async function allFileText(): Promise<string> {
  const names = await readdir(dir);
  const texts = await Promise.all(names.map((n) => readFile(join(dir, n), 'utf8')));
  return texts.join('\n');
}

describe('runProbe (against a synthetic fake)', () => {
  it('captures every planned endpoint into named files', async () => {
    const { report } = await probe();
    expect(report.authenticated).toBe(true);
    expect((await readdir(dir)).sort()).toEqual(
      [
        'account-by-name.json',
        'accounts-bulk-over-limit.json',
        'accounts-bulk.json',
        'cms-tournamentinformation.json',
        'error-missing-window.json',
        'error-noauth-events.json',
        'events-data-NAE.json',
        'events-download-EU.json',
        'events-download-NAE.json',
        'events-download-noregion.json',
        'history-player-final.json',
        'history-window-final.json',
        'leaderboard-duos-p0.json',
        'leaderboard-final-filtered.json',
        'leaderboard-final-last.json',
        'leaderboard-final-p0.json',
        'leaderboard-final-p1.json',
        'leaderboard-live-p0-liveSessions.json',
        'leaderboard-live-p0.json',
        'leaderboard-upcoming-p0.json',
        'oauth-token.json',
        'player-tokens.json',
        'probe-report.json',
      ].sort(),
    );
    expect(Object.keys(report.samples).sort()).toEqual(['duos', 'final', 'live', 'upcoming']);
    expect(report.notes).toContain('No wrapping window this run; capture again when one exists.');
  });

  it('never writes tokens or device credentials to disk', async () => {
    await probe();
    const text = await allFileText();
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, config.device.secret, config.device.deviceId, config.client.secret]) {
      expect(text).not.toContain(secret);
    }
    const token = JSON.parse(await readFile(join(dir, 'oauth-token.json'), 'utf8'));
    expect(token.access_token).toBe('[redacted]');
    expect(token.expires_in).toBe(7200);
  });

  it('keeps only id and displayName from account lookups, and drops the token country', async () => {
    await probe();
    const text = await allFileText();
    for (const personal of ['owner@example.com', '"Owner"', 'psn-name', '"US"']) expect(text).not.toContain(personal);
    const self = JSON.parse(await readFile(join(dir, 'account-by-name.json'), 'utf8'));
    expect(self).toEqual({ id: SERVICE_ACCOUNT, displayName: 'YosikService', email: '[redacted]', lastName: '[redacted]' });
    const bulk = JSON.parse(await readFile(join(dir, 'accounts-bulk.json'), 'utf8'));
    expect(bulk[0]).toMatchObject({ externalAuths: '[redacted]' });
    expect(bulk[0].displayName).toMatch(/^name-/);
    const over = JSON.parse(await readFile(join(dir, 'accounts-bulk-over-limit.json'), 'utf8'));
    expect(over.errorCode).toBe('errors.com.epicgames.account.too_many_accounts');
  });

  it('sends the bearer token to Epic APIs but not to the CMS or the no-auth check', async () => {
    const { epic } = await probe();
    const cms = epic.calls.find((c) => c.url.includes('tournamentinformation'))!;
    expect(cms.auth).toBeUndefined();
    expect(epic.calls.filter((c) => c.url.includes('/leaderboards/')).every((c) => c.auth === `bearer ${ACCESS_TOKEN}`)).toBe(true);
    expect(epic.calls[1]!.auth).toBeUndefined();
  });

  it('spaces calls using the injected sleep', async () => {
    const waits: number[] = [];
    await probe({}, { spacingMs: 1000, sleep: async (ms) => void waits.push(ms) });
    expect(waits.length).toBeGreaterThan(10);
    expect(waits.every((ms) => ms > 0 && ms <= 1000)).toBe(true);
  });

  it('stops after a failed token mint and says why', async () => {
    const { report, byId } = await probe({ tokenStatus: 400 });
    expect(report.authenticated).toBe(false);
    expect(report.notes[0]).toMatch(/Token mint failed/);
    expect((await readdir(dir)).sort()).toEqual(['cms-tournamentinformation.json', 'error-noauth-events.json', 'probe-report.json']);
    expect(byId('token').answer).toBe('Not minted in this run.');
    expect(byId('token').evidence[0]).toMatch(/HTTP 400 errors\.com\.epicgames\.account\.invalid_account_credentials/);
  });

  it('runs only unauthenticated checks without credentials', async () => {
    const { report, epic } = await probe({}, { config: undefined });
    expect(epic.calls).toHaveLength(2);
    expect(report.calls.map((c) => c.status)).toEqual([200, 401]);
    expect(report.calls[1]!.errorCode).toBe('errors.com.epicgames.common.authentication.authentication_failed');
  });

  it('records network failures instead of crashing', async () => {
    const down: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const report = await runProbe({ config, outDir: dir, fetch: down, now: () => now, spacingMs: 0 });
    expect(report.calls.every((c) => c.status === 0 && c.error === 'fetch failed')).toBe(true);
    const run = await loadRun(dir);
    expect(analyze(run.report, run.files).find((f) => f.id === 'reachability')!.answer).toBe(
      'No: every call failed at the network level.',
    );
  });

  it('stops the rate test at the first 429', async () => {
    const { report, byId } = await probe({ rateLimitAfter: 6 }, { rateTest: 20 });
    // 2 regions + noregion + data = 4 events calls before the test, so the 3rd test call is the 7th.
    expect(report.rateTest).toEqual({ requests: 3, statuses: [200, 200, 429], first429At: 3, retryAfter: '30' });
    expect(byId('rate').answer).toBe('429 after 3 back-to-back requests, Retry-After 30.');
  });
});

describe('analyze (against a synthetic fake)', () => {
  it('answers the checklist from captured files', async () => {
    const { byId } = await probe();
    expect(byId('reachability').answer).toMatch(/^\d+ of \d+ calls got an HTTP response\.$/);
    expect(byId('token').answer).toBe('Minted. expires_in=7200s, token_type=bearer, refresh token issued.');
    expect(byId('regions').answer).toMatch(/^Possibly: .* covering EU, NAE\.$/);
    expect(byId('window-fields').answer).toMatch(/^6 windows across 2 events\. payoutDelay values: 30-30/);
    expect(byId('window-fields').evidence).toContain('payoutDelay: 6/6');
    expect(byId('window-fields').evidence).toContain('blackoutPeriods: 0/6');
    expect(byId('scoring').evidence.some((e) => e.includes('templates[].scoringRules'))).toBe(true);
    expect(byId('leaderboard').answer).toBe('Final page 0 holds 60 entries of 5 pages.');
    expect(byId('leaderboard').evidence).toContain(
      'sessionHistory[].trackedStats keys: PLACEMENT_STAT_INDEX, TEAM_ELIMS_STAT_INDEX',
    );
    expect(byId('filtered').answer).toMatch(/^Yes: HTTP 200/);
    expect(byId('bulk-accounts').answer).toBe('100 IDs -> HTTP 200; 101 IDs -> HTTP 400 errors.com.epicgames.account.too_many_accounts');
    expect(byId('cms').answer).toBe('1 of 1 event displayDataId values appear in the CMS document.');
    expect(byId('cumulative').answer).toMatch(/^Nothing in this capture mentions "cumulative"/);
    expect(byId('rate').answer).toBe('Not tested (run the probe with --rate-test N).');
  });

  it('finds cumulative boards referenced as score locations, not just as window IDs', () => {
    const events = {
      events: [
        {
          eventId: 'epicgames_S99_FNCS_NAE',
          eventWindows: [
            { eventWindowId: 'S99_FNCS_Day1_NAE', scoreLocations: [{ leaderboardDefId: 'Official_CumulativeLeaderboardDef' }] },
          ],
        },
      ],
      resolvedWindowLocations: { x: ['cumulative:epicgames_S99_FNCS_NAE_cumulative'] },
    };
    const f = analyze(undefined, new Map([['events-download-NAE.json', events]])).find((x) => x.id === 'cumulative')!;
    expect(f.answer).toBe('Not as windows, but the events payload references 2 cumulative score locations or leaderboard defs.');
    expect(f.evidence).toEqual(['Official_CumulativeLeaderboardDef', 'cumulative:epicgames_S99_FNCS_NAE_cumulative']);
  });

  it('notices when teamAccountIds does not filter', async () => {
    const { byId } = await probe({ filterWorks: false });
    expect(byId('filtered').answer).toMatch(/^No: HTTP 200, 60 entries returned, 1 match the target\./);
  });

  it('renders markdown with one section per finding', async () => {
    const { run, findings } = await probe();
    const md = renderAnalysis('run', run.report, findings);
    expect(md.startsWith('# Probe analysis: run')).toBe(true);
    expect(md.match(/^## /gm)).toHaveLength(findings.length);
  });
});

describe('message', () => {
  it('surfaces the cause Node hides behind "fetch failed"', () => {
    expect(message(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND x') }))).toBe(
      'fetch failed (getaddrinfo ENOTFOUND x)',
    );
    expect(message(new Error('plain'))).toBe('plain');
    expect(message('str')).toBe('str');
  });
});

describe('shapeOf', () => {
  it('sketches nested JSON compactly', () => {
    expect(shapeOf({ a: [{ b: 1 }, { b: 2 }], c: null, d: [] })).toBe('{ a: [2× { b: number }], c: null, d: [] }');
    expect(shapeOf({ a: { b: { c: 1 } } }, 1)).toBe('{ a: {1 keys} }');
  });
});
