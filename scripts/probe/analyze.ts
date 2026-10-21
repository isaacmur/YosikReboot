// Reads one probe run directory and answers the Phase 0 checklist questions from
// what was actually captured. It reports shapes and presence counts; deciding
// what they mean for the app is left to whoever fills in EPIC_API_NOTES.md.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REGIONS } from '../../lib/types';
import type { ProbeReport } from './run';
import { asArr, asObj } from './select';

export interface Finding {
  id: string;
  question: string;
  answer: string;
  evidence: string[];
}

/** Window fields the developer plan expects; the analyzer counts each one. */
export const EXPECTED_WINDOW_FIELDS = [
  'eventWindowId',
  'eventTemplateId',
  'beginTime',
  'endTime',
  'countdownBeginTime',
  'round',
  'payoutDelay',
  'isTBD',
  'canLiveSpectate',
  'blackoutPeriods',
  'scoreLocations',
  'requireAllTokens',
  'requireAnyTokens',
  'requireNoneTokensCaller',
  'teammateEligibility',
  'metadata',
] as const;

/**
 * A compact sketch of a JSON value's structure, e.g. `{ entries: [100× { rank: number }] }`.
 * Only object nesting counts toward `depth`; arrays show their first element.
 */
export function shapeOf(value: unknown, depth = 2): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${value.length}× ${shapeOf(value[0], depth)}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (depth <= 0) return `{${keys.length} keys}`;
    const parts = keys.map((k) => `${k}: ${shapeOf((value as Record<string, unknown>)[k], depth - 1)}`);
    return `{ ${parts.join(', ')} }`;
  }
  return typeof value;
}

function keyCounts(objs: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of objs) {
    for (const k of Object.keys(asObj(o) ?? {})) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Every path under `root` whose key matches `re`, up to `max` results. */
function findKeys(root: unknown, re: RegExp, max = 15): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, path: string) => {
    if (out.length >= max) return;
    if (Array.isArray(v)) {
      if (v.length) visit(v[0], `${path}[]`);
      return;
    }
    const o = asObj(v);
    if (!o) return;
    for (const [k, child] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (re.test(k) && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
      visit(child, p);
    }
  };
  visit(root, '');
  return out;
}

function allStringsAndKeys(root: unknown, into = new Set<string>()): Set<string> {
  if (typeof root === 'string') into.add(root);
  else if (Array.isArray(root)) root.forEach((v) => allStringsAndKeys(v, into));
  else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      into.add(k);
      allStringsAndKeys(v, into);
    }
  }
  return into;
}

const regionSuffix = new RegExp(`_(${REGIONS.join('|')})$`);

function regionsOf(event: unknown): string[] {
  const e = asObj(event);
  const listed = asArr(e?.regions).filter((r): r is string => typeof r === 'string');
  if (listed.length) return listed;
  const m = typeof e?.eventId === 'string' ? regionSuffix.exec(e.eventId) : null;
  return m?.[1] ? [m[1]] : [];
}

export async function loadRun(dir: string): Promise<{ report?: ProbeReport; files: Map<string, unknown> }> {
  const files = new Map<string, unknown>();
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      files.set(name, JSON.parse(await readFile(join(dir, name), 'utf8')));
    } catch {
      // Not JSON we wrote; ignore.
    }
  }
  return { report: files.get('probe-report.json') as ProbeReport | undefined, files };
}

export function analyze(report: ProbeReport | undefined, files: Map<string, unknown>): Finding[] {
  const findings: Finding[] = [];
  const calls = report?.calls ?? [];
  const callFor = (step: string) => calls.find((c) => c.step === step);
  const add = (id: string, question: string, answer: string, evidence: string[] = []) =>
    findings.push({ id, question, answer, evidence });

  // Reachability
  const failed = calls.filter((c) => c.status === 0);
  add(
    'reachability',
    'Could the probe reach Epic at all?',
    calls.length === 0
      ? 'No calls recorded.'
      : failed.length === calls.length
        ? 'No: every call failed at the network level.'
        : `${calls.length - failed.length} of ${calls.length} calls got an HTTP response.`,
    failed.slice(0, 5).map((c) => `${c.step}: ${c.error}`),
  );

  // Token
  const t = report?.token;
  add(
    'token',
    'Token mint: lifetime and refresh',
    report?.authenticated && t
      ? `Minted${t.exchanged ? ' (after exchange to a second client)' : ''}. expires_in=${t.expiresIn ?? '?'}s, token_type=${t.tokenType ?? '?'}, refresh token ${t.hasRefreshToken ? 'issued' : 'not issued'}.`
      : 'Not minted in this run.',
    [callFor('oauth.device_auth'), callFor('oauth.exchange')]
      .filter((c) => !!c)
      .map((c) => `${c.step}: HTTP ${c.status}${c.errorCode ? ` ${c.errorCode}` : ''}`),
  );

  // Regions
  const regionFiles = [...files.keys()].filter((f) => /^events-download-[A-Z]+\.json$/.test(f));
  const perRegion = regionFiles.map((f) => `${f}: ${asArr(asObj(files.get(f))?.events).length} events`);
  const noRegion = files.get('events-download-noregion.json');
  if (noRegion !== undefined) {
    const events = asArr(asObj(noRegion)?.events);
    const seen = new Set(events.flatMap(regionsOf));
    add(
      'regions',
      'Does one schedule call return all eight regions?',
      seen.size > 1
        ? `Possibly: the call without region= returned ${events.length} events covering ${[...seen].sort().join(', ')}.`
        : `No evidence: the call without region= returned ${events.length} events (${[...seen].join(', ') || 'no region info'}). Fan out per region.`,
      perRegion,
    );
  } else {
    add('regions', 'Does one schedule call return all eight regions?', 'Not captured.', perRegion);
  }

  // Window fields
  const allEvents = regionFiles.flatMap((f) => asArr(asObj(files.get(f))?.events));
  const allWindows = allEvents.flatMap((e) => asArr(asObj(e)?.eventWindows));
  if (allWindows.length) {
    const counts = keyCounts(allWindows);
    const expected = EXPECTED_WINDOW_FIELDS.map((k) => `${k}: ${counts.get(k) ?? 0}/${allWindows.length}`);
    const extra = [...counts.keys()].filter((k) => !(EXPECTED_WINDOW_FIELDS as readonly string[]).includes(k));
    const delays = allWindows.map((w) => asObj(w)?.payoutDelay).filter((d): d is number => typeof d === 'number');
    add(
      'window-fields',
      'Which window fields are actually present?',
      `${allWindows.length} windows across ${allEvents.length} events. payoutDelay values: ${
        delays.length ? `${Math.min(...delays)}-${Math.max(...delays)} (unit unconfirmed; minutes expected)` : 'none'
      }.`,
      [...expected, `other keys: ${extra.join(', ') || 'none'}`, `window shape: ${shapeOf(allWindows[0], 1)}`],
    );
  } else {
    add('window-fields', 'Which window fields are actually present?', 'No windows captured.');
  }

  // Scoring and payouts
  const scoringSources = [
    'events-download-noregion.json',
    ...regionFiles.slice(0, 1),
    ...[...files.keys()].filter((f) => f.startsWith('events-data-')),
  ];
  const scoringEvidence = scoringSources
    .filter((f) => files.has(f))
    .flatMap((f) => {
      const body = asObj(files.get(f));
      return [
        `${f} top-level keys: ${Object.keys(body ?? {}).join(', ')}`,
        `${f} scoring/payout paths: ${findKeys(body, /scor|payout/i).join(', ') || 'none'}`,
      ];
    });
  add(
    'scoring',
    'Where do the scoring and payout tables live?',
    scoringEvidence.length ? 'See the key paths below.' : 'Not captured.',
    scoringEvidence,
  );

  // Leaderboard shape
  const lbFiles = [...files.keys()].filter((f) => f.startsWith('leaderboard-')).sort();
  const lbEvidence: string[] = [];
  let sampleEntry: unknown;
  for (const f of lbFiles) {
    const body = asObj(files.get(f));
    const entries = asArr(body?.entries);
    sampleEntry ??= entries[0];
    const teamSizes = [...new Set(entries.map((e) => asArr(asObj(e)?.teamAccountIds).length))];
    lbEvidence.push(
      `${f}: ${entries.length} entries, page=${String(body?.page)}, totalPages=${String(body?.totalPages)}, team sizes ${teamSizes.join('/') || '-'}`,
    );
  }
  if (sampleEntry) {
    const allEntries = lbFiles.flatMap((f) => asArr(asObj(files.get(f))?.entries));
    lbEvidence.push(`entry keys: ${[...keyCounts(allEntries).keys()].join(', ')}`);
    const sessions = allEntries.flatMap((e) => asArr(asObj(e)?.sessionHistory));
    const stats = keyCounts(sessions.map((s) => asObj(s)?.trackedStats));
    lbEvidence.push(`sessionHistory[].trackedStats keys: ${[...stats.keys()].join(', ') || 'none'}`);
    lbEvidence.push(`entry shape: ${shapeOf(sampleEntry, 2)}`);
  }
  const p0 = asObj(files.get('leaderboard-final-p0.json'));
  add(
    'leaderboard',
    'Leaderboard page size and entry shape',
    p0
      ? `Final page 0 holds ${asArr(p0.entries).length} entries of ${String(p0.totalPages)} pages.`
      : 'No final leaderboard captured.',
    lbEvidence,
  );

  // Filtered lookup
  const filtered = files.get('leaderboard-final-filtered.json');
  if (filtered !== undefined) {
    const target = report?.filteredTarget ?? [];
    const entries = asArr(asObj(filtered)?.entries);
    const matching = entries.filter((e) => {
      const ids = asArr(asObj(e)?.teamAccountIds);
      return target.some((id) => ids.includes(id));
    });
    const status = callFor('leaderboard.final.filtered')?.status;
    add(
      'filtered',
      "Can one team's row be fetched directly (teamAccountIds=)?",
      entries.length > 0 && matching.length === entries.length
        ? `Yes: HTTP ${status}, all ${entries.length} returned entries are the target team.`
        : `No: HTTP ${status}, ${entries.length} entries returned, ${matching.length} match the target. Fall back to scanning pages for final windows.`,
    );
  } else {
    add('filtered', "Can one team's row be fetched directly (teamAccountIds=)?", 'Not captured.');
  }

  // Cumulative: separate windows, or score locations / leaderboard defs inside the events payload?
  const cumulativeWindows = allWindows
    .map((w) => asObj(w)?.eventWindowId)
    .filter((id): id is string => typeof id === 'string' && /cumulative/i.test(id));
  const cumulativeRefs = [
    ...new Set(regionFiles.flatMap((f) => [...allStringsAndKeys(files.get(f))].filter((s) => /cumulative/i.test(s)))),
  ].sort();
  add(
    'cumulative',
    'Are cumulative leaderboards separate windows?',
    cumulativeWindows.length
      ? `Yes, at least for some events: ${cumulativeWindows.length} window IDs mention "cumulative".`
      : cumulativeRefs.length
        ? `Not as windows, but the events payload references ${cumulativeRefs.length} cumulative score locations or leaderboard defs.`
        : 'Nothing in this capture mentions "cumulative"; check an FNCS event with multiple sessions.',
    [...cumulativeWindows, ...cumulativeRefs].slice(0, 8),
  );

  // Bulk accounts
  const bulk = calls.filter((c) => c.step.startsWith('accounts.bulk.'));
  const bulkBody = files.get('accounts-bulk.json');
  add(
    'bulk-accounts',
    'Bulk account lookup limit',
    bulk.length
      ? bulk
          .map(
            (c) =>
              `${c.step.replace('accounts.bulk.', '')} IDs -> HTTP ${c.status}${c.errorCode ? ` ${c.errorCode}` : ''}`,
          )
          .join('; ')
      : 'Not captured.',
    bulkBody !== undefined ? [`response shape: ${shapeOf(bulkBody, 2)}`] : [],
  );

  // Rate limit
  const rt = report?.rateTest;
  add(
    'rate',
    'Rough rate limit',
    rt
      ? rt.first429At
        ? `429 after ${rt.first429At} back-to-back requests${rt.retryAfter ? `, Retry-After ${rt.retryAfter}` : ''}.`
        : `No 429 in ${rt.requests} back-to-back requests.`
      : 'Not tested (run the probe with --rate-test N).',
  );

  // CMS join
  const cms = files.get('cms-tournamentinformation.json');
  const displayIds = [
    ...new Set(allEvents.map((e) => asObj(e)?.displayDataId).filter((d): d is string => typeof d === 'string')),
  ];
  if (cms !== undefined) {
    const vocab = allStringsAndKeys(cms);
    const found = displayIds.filter((d) => vocab.has(d));
    add(
      'cms',
      'How does the CMS join to events?',
      displayIds.length
        ? `${found.length} of ${displayIds.length} event displayDataId values appear in the CMS document.`
        : 'CMS captured, but no displayDataId values were found on events to join with.',
      [
        `CMS top-level keys: ${Object.keys(asObj(cms) ?? {}).join(', ')}`,
        `example tournament-like paths: ${findKeys(cms, /tournament/i, 5).join(', ') || 'none'}`,
      ],
    );
  } else {
    add('cms', 'How does the CMS join to events?', 'CMS not captured.');
  }

  // Errors and secondary endpoints
  const errorish = calls.filter((c) => c.status >= 400);
  add(
    'errors',
    'Error responses seen',
    errorish.length ? `${errorish.length} calls returned 4xx/5xx.` : 'None.',
    errorish.map((c) => `${c.step}: HTTP ${c.status}${c.errorCode ? ` ${c.errorCode}` : ''}`),
  );
  for (const [file, id, question] of [
    ['history-window-final.json', 'history-window', 'Window history endpoint'],
    ['history-player-final.json', 'history-player', 'Player window history endpoint'],
    ['player-tokens.json', 'tokens', 'Player tokens endpoint'],
    ['account-by-name.json', 'by-name', 'Display name lookup'],
  ] as const) {
    const body = files.get(file);
    add(id, question, body === undefined ? 'Not captured.' : shapeOf(body, 2));
  }

  for (const n of report?.notes ?? []) add('note', 'Probe note', n);
  return findings;
}

export function renderAnalysis(dir: string, report: ProbeReport | undefined, findings: Finding[]): string {
  const lines = [
    `# Probe analysis: ${dir}`,
    '',
    `Run ${report?.startedAt ?? '?'} → ${report?.finishedAt ?? '?'}, authenticated: ${report?.authenticated ? 'yes' : 'no'}.`,
    '',
    'Generated by `npm run epic:analyze`. Copy conclusions into docs/EPIC_API_NOTES.md.',
    '',
  ];
  for (const f of findings) {
    lines.push(`## ${f.question}`, '', f.answer, '');
    for (const e of f.evidence) lines.push(`- ${e}`);
    if (f.evidence.length) lines.push('');
  }
  return lines.join('\n');
}
