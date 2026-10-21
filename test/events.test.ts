// Schedule parsing against the anonymized live capture (test/fixtures/epic/first).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexCms } from '../lib/epic/cms';
import {
  classifyMode,
  classifyType,
  homeRegion,
  humanize,
  normalizeEvents,
  platformGroups,
  requirements,
  teamSizeOf,
  windowLabel,
} from '../lib/epic/events';
import { eventState, nextWindow } from '../lib/status';
import { REGIONS, type EventInfo } from '../lib/types';

const DIR = join(__dirname, 'fixtures/epic/first');
const load = (f: string): unknown => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const cms = indexCms(load('cms-tournamentinformation.json'));
const byRegion = Object.fromEntries(REGIONS.map((r) => [r, normalizeEvents(load(`events-download-${r}.json`), cms)]));
const find = (id: string): EventInfo => {
  const e = REGIONS.flatMap((r) => byRegion[r]!).find((x) => x.id === id);
  if (!e) throw new Error(`no event ${id}`);
  return e;
};

describe('normalizeEvents on the live capture', () => {
  it('keeps every event in each region, each with at least one valid session', () => {
    expect(byRegion.NAE).toHaveLength(32);
    expect(byRegion.EU).toHaveLength(29);
    for (const r of REGIONS) {
      for (const e of byRegion[r]!) {
        expect(e.regions, e.id).toContain(r);
        expect(e.windows.length).toBeGreaterThan(0);
        for (const w of e.windows) {
          expect(w.eventId).toBe(e.id);
          expect(Date.parse(w.end)).toBeGreaterThan(Date.parse(w.begin));
        }
      }
    }
  });

  it('sorts sessions by start time', () => {
    for (const e of byRegion.NAC!) {
      const begins = e.windows.map((w) => w.begin);
      expect(begins).toEqual([...begins].sort());
    }
  });

  it('classifies real events correctly', () => {
    const cases: [string, Partial<EventInfo>][] = [
      ['epicgames_S42_FNCSSolo_Final_NAC', { type: 'FNCS', mode: 'BR', zeroBuild: false, teamSize: 1 }],
      ['epicgames_S43_FNCSSoloReload_Final_EU', { type: 'FNCS', mode: 'RELOAD', teamSize: 1 }],
      [
        'epicgames_S42_RankedCupReloadDuos_ZB_NAW',
        { type: 'RANKED_CUP', mode: 'RELOAD', zeroBuild: true, teamSize: 2 },
      ],
      ['epicgames_S42_RankedCupSolo_EU', { type: 'RANKED_CUP', mode: 'BR', zeroBuild: false, teamSize: 1 }],
      ['epicgames_S42_PurgeCup_ZB_EU', { type: 'PROMO_CUP', mode: 'BR', zeroBuild: true, teamSize: 1 }],
      ['epicgames_S42_SlenderManCup_NAC', { type: 'PROMO_CUP', mode: 'RELOAD', zeroBuild: false, teamSize: 2 }],
      ['epicgames_S42_ChampionTealKnightFNCSCup_EU', { type: 'PROMO_CUP', mode: 'BR' }],
      ['epicgames_S42_ReloadCashCup_DuosZB_NAW', { type: 'CASH_CUP', mode: 'RELOAD', zeroBuild: true, teamSize: 2 }],
      ['epicgames_S42_ReloadReloadSoloVictoryCup_EU', { type: 'VICTORY_CUP', mode: 'RELOAD', teamSize: 1 }],
      ['epicgames_S42_PerformanceEvaluationTrios_NAC', { type: 'PERF_EVAL', mode: 'BR', teamSize: 3 }],
      ['epicgames_S42_ArenaTestCup_EU', { mode: 'OTHER' }],
    ];
    for (const [id, expected] of cases) expect(find(id), id).toMatchObject(expected);
  });

  it('flags mobile events and the global LAN event', () => {
    expect(find('epicgames_S42_SlenderManCup_MobileAll_EU').mobileOnly).toBe(true);
    expect(find('epicgames_S42_SlenderManCup_EU').mobileOnly).toBe(false);
    const lan = find('epicgames_Bog_Official');
    expect(lan).toMatchObject({ homeRegion: 'GLOBAL', mobileOnly: true });
    expect(lan.regions).toEqual(expect.arrayContaining([...REGIONS]));
  });

  it('takes titles, descriptions and posters from the CMS', () => {
    const purge = find('epicgames_S42_PurgeCup_EU');
    expect(purge).toMatchObject({ name: 'Lady Liberty Cup', subtitle: 'Battle Royale' });
    expect(purge.description).toMatch(/Lady Liberty/);
    expect(purge.posterUrl).toMatch(/^https:\/\/cdn2\.unrealengine\.com\//);
    expect(purge.color).toMatch(/^[0-9A-F]{6}$/);
    const fromCms = byRegion.NAC!.filter((e) => e.posterUrl !== undefined);
    expect(fromCms.length / byRegion.NAC!.length).toBeGreaterThan(0.9);
  });

  it('labels sessions from their window IDs', () => {
    const final = find('epicgames_S42_FNCSSolo_Final_NAC');
    expect(final.windows.map((w) => w.label)).toEqual(['Day 1', 'Day 2']);
    expect(find('epicgames_S42_RankedCupSolo_EU').windows[0]!.label).toMatch(/^Event \d+$/);
    expect(find('epicgames_S42_SlenderManCup_ZB_EU').windows.map((w) => w.label)).toEqual(['Session']);
    // No label repeats the season or series prefix.
    for (const r of REGIONS)
      for (const e of byRegion[r]!) for (const w of e.windows) expect(w.label, w.id).not.toMatch(/^S \d+ /);
  });

  it('turns entry rules into plain language', () => {
    const final = find('epicgames_S42_FNCSSolo_Final_NAC');
    expect(final.windows[0]!.requirements).toContain('Qualified players only (FNCSSolo Finalist NAC)');
    expect(final.windows[0]!.requirements).toContain('Two-factor authentication on');
    const ranked = find('epicgames_S42_RankedCupSolo_EU').windows[0]!.requirements;
    expect(ranked.some((r) => /^Needs a rank in .+ ranked$/.test(r))).toBe(true);
    expect(find('epicgames_S42_RankedCupSolo_EU').minAccountLevel).toBeGreaterThan(0);
  });

  it('groups platforms', () => {
    expect(find('epicgames_S42_PurgeCup_EU').platforms).toEqual(['PC', 'CONSOLE', 'MOBILE', 'CLOUD']);
    const noMobile = byRegion.EU!.filter((e) => !e.platforms.includes('MOBILE'));
    expect(noMobile.length).toBeGreaterThan(0);
  });

  it('skips malformed input instead of throwing', () => {
    expect(normalizeEvents(undefined, cms)).toEqual([]);
    expect(normalizeEvents({ events: [{ eventId: 'x', eventWindows: [{ eventWindowId: 'w' }] }] }, cms)).toEqual([]);
  });
});

describe('classifiers', () => {
  it('reads the home region from the ID suffix', () => {
    expect(homeRegion('epicgames_S42_RankedCupSolo_NAC')).toBe('NAC');
    expect(homeRegion('epicgames_Bog_Official')).toBe('GLOBAL');
  });

  it('falls back to the event ID when metadata is missing', () => {
    expect(classifyType(undefined, 'epicgames_S99_RankedCupDuos_EU')).toBe('RANKED_CUP');
    expect(classifyType(undefined, 'epicgames_S99_FNCSDuos_Heats_EU')).toBe('FNCS');
    expect(classifyType(undefined, 'epicgames_S99_SomethingNew_EU')).toBe('OTHER');
    expect(classifyType('ShopCup', 'epicgames_S99_PerformanceEvaluation_EU')).toBe('PERF_EVAL');
  });

  it('detects Reload, zero build and team size from playlists', () => {
    expect(classifyMode(['Playlist_ShowdownTournament_BlastBerryNoBuildDuo_RC'], 'e')).toBe('RELOAD');
    expect(classifyMode(['Playlist_ShowdownTournament_FN_Squads'], 'e')).toBe('BR');
    expect(teamSizeOf(['Playlist_ShowdownTournament_FN_Squads'], 'e')).toBe(4);
    expect(teamSizeOf([], 'epicgames_S99_Thing_EU')).toBeNull();
  });

  it('humanizes IDs and labels', () => {
    expect(humanize('Qual1Round1Day2')).toBe('Qual 1 Round 1 Day 2');
    expect(
      windowLabel('S43_FNCSSoloReloadQualifiers_Qual1Round1Day2_NAW', 'epicgames_S43_FNCSSoloReloadQualifiers_NAW'),
    ).toBe('Qual 1 Round 1 Day 2');
    expect(windowLabel('BOG_DAY1', 'epicgames_Bog_Official')).toBe('DAY 1');
    expect(windowLabel('S42_FNCSSolo_LastChanceLobby_NAW', 'epicgames_S42_FNCSSolo_LastChanceQualifier_NAW')).toBe(
      'Last Chance Lobby',
    );
    expect(
      windowLabel('S42_PerformanceEvaluation_Event9_Round1_NAC', 'epicgames_S42_PerformanceEvaluationTrios_NAC'),
    ).toBe('Event 9 Round 1');
    expect(windowLabel('S42_SlenderManCup_ZB_EU', 'epicgames_S42_SlenderManCup_ZB_EU')).toBe('');
  });

  it('maps unknown platforms to cloud and keeps a stable order', () => {
    expect(platformGroups(['Android', 'Windows', 'Luna'])).toEqual(['PC', 'MOBILE', 'CLOUD']);
  });

  it('marks invite-only sessions', () => {
    expect(requirements({ requireAllTokens: ['fake_token'] })).toEqual(['Invite only']);
  });
});

describe('event state', () => {
  const at = (iso: string) => new Date(iso);
  const w = (begin: string, end: string) => ({ begin, end, payoutDelayMin: 30 });
  const ws = [w('2026-10-21T18:00:00Z', '2026-10-21T21:00:00Z'), w('2026-10-22T18:00:00Z', '2026-10-22T21:00:00Z')];

  it('is live while any session is live or wrapping up', () => {
    expect(eventState(ws, at('2026-10-21T17:00:00Z'))).toBe('upcoming');
    expect(eventState(ws, at('2026-10-21T19:00:00Z'))).toBe('live');
    expect(eventState(ws, at('2026-10-21T21:10:00Z'))).toBe('live');
    expect(eventState(ws, at('2026-10-22T00:00:00Z'))).toBe('upcoming');
    expect(eventState(ws, at('2026-10-23T00:00:00Z'))).toBe('ended');
  });

  it('points at the live session, else the next one', () => {
    expect(nextWindow(ws, at('2026-10-21T19:00:00Z'))).toBe(ws[0]);
    expect(nextWindow(ws, at('2026-10-21T22:00:00Z'))).toBe(ws[1]);
    expect(nextWindow(ws, at('2026-10-23T00:00:00Z'))).toBeUndefined();
  });
});
