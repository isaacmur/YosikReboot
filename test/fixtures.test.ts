// Checks the committed (anonymized) live capture still hangs together, so the
// Phase 1 parsers can rely on it. Shapes asserted here are recorded in
// docs/EPIC_API_NOTES.md.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONS } from '../lib/types';
import { asArr, asObj, listWindows } from '../scripts/probe/select';

const DIR = join(__dirname, 'fixtures/epic/first');
const load = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

describe('fixture: first live capture (anonymized)', () => {
  it('has a schedule for every region, listing only events visible in that region', () => {
    for (const r of REGIONS) {
      const doc = load(`events-download-${r}.json`);
      expect(listWindows(doc).length, r).toBeGreaterThan(0);
      for (const e of asArr(asObj(doc)!.events)) expect(asArr(asObj(e)!.regions), r).toContain(r);
    }
  });

  it('has no NAE-suffixed events: NAE sees NAC/NAW events (D11)', () => {
    const ids = asArr(asObj(load('events-download-NAE.json'))!.events).map((e) => String(asObj(e)!.eventId));
    expect(ids.some((id) => id.endsWith('_NAE'))).toBe(false);
    expect(ids.some((id) => id.endsWith('_NAC'))).toBe(true);
  });

  it('resolves every window to scoring through its score location', () => {
    const d = asObj(load('events-download-NAE.json'))!;
    const rules = asObj(d.scoringRuleSets)!;
    const byLocation = asObj(d.scoreLocationScoringRuleSets)!;
    for (const w of listWindows(d)) {
      const id = byLocation[`Fortnite:${w.eventId}:${w.windowId}`];
      if (typeof id === 'string') expect(rules[id], id).toBeDefined();
    }
  });

  it('has 100-entry leaderboard pages whose teamId matches teamAccountIds', () => {
    const lb = asObj(load('leaderboard-final-p0.json'))!;
    const entries = asArr(lb.entries).map((e) => asObj(e)!);
    expect(entries).toHaveLength(100);
    expect(lb.totalPages).toBe(100);
    for (const e of entries) {
      const ids = asArr(e.teamAccountIds) as string[];
      expect(new Set(String(e.teamId).split(':'))).toEqual(new Set(ids));
      for (const id of ids) expect(id).toMatch(/^f0+\d+$/);
    }
  });

  it('keeps cross-file references intact after anonymization', () => {
    const board = new Set(
      asArr(asObj(load('leaderboard-final-p0.json'))!.entries).flatMap(
        (e) => asArr(asObj(e)!.teamAccountIds) as string[],
      ),
    );
    const bulk = asArr(load('accounts-bulk.json')).map((a) => asObj(a)!);
    expect(bulk).toHaveLength(100);
    for (const a of bulk) {
      expect(board.has(a.id as string)).toBe(true);
      expect(a.displayName).toMatch(/^Player\d{5}$/);
    }
  });
});
