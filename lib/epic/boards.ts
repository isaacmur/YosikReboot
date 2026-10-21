// A window's leaderboards ("score locations"). Every window has a main board;
// Ranked Cups add one board per rank tier, and FNCS events reference a
// cumulative board. Epic lists them in `resolvedWindowLocations` as
// `Fortnite:<group>:<instance>`; the leaderboard URL takes <group> as the event ID
// and <instance> as the window ID. Cumulative boards (group "cumulative") are not
// served by that endpoint (verified 2026-10-21), so they're marked unfetchable.

import type { BoardInfo, BoardKind } from '../types.js';
import { asArr, asObj, str } from './json.js';
import { parsePayouts, parseRules, summarizeScoring, type ScoringRule } from './scoring.js';

export interface ScoreLocation {
  /** `Fortnite:<group>:<instance>`, the key Epic's scoring and payout maps use. */
  key: string;
  group: string;
  instance: string;
}

export function parseScoreLocation(key: string): ScoreLocation | undefined {
  const m = /^Fortnite:([^:]+):([^:]+)$/.exec(key);
  return m ? { key, group: m[1]!, instance: m[2]! } : undefined;
}

export const locationKey = (eventId: string, windowId: string) => `Fortnite:${eventId}:${windowId}`;

/** All score locations Epic lists for a window, the window's own board first. */
export function windowLocations(rawSchedule: unknown, eventId: string, windowId: string): ScoreLocation[] {
  const own = locationKey(eventId, windowId);
  const listed = asArr(asObj(asObj(rawSchedule)?.resolvedWindowLocations)?.[own])
    .map((k) => str(k))
    .filter((k): k is string => !!k);
  const keys = [own, ...listed.filter((k) => k !== own)];
  return keys.map(parseScoreLocation).filter((l): l is ScoreLocation => !!l);
}

export const isFetchable = (l: ScoreLocation) => l.group !== 'cumulative';

/** Scoring rules for one board: its score location's rule set, else the window template's. */
export function boardRules(rawSchedule: unknown, loc: ScoreLocation, templateRules?: unknown): ScoringRule[] {
  const raw = asObj(rawSchedule);
  const setId = str(asObj(raw?.scoreLocationScoringRuleSets)?.[loc.key]);
  const set = setId ? asObj(raw?.scoringRuleSets)?.[setId] : undefined;
  return parseRules(set ?? templateRules);
}

function boardPayouts(rawSchedule: unknown, loc: ScoreLocation): ReturnType<typeof parsePayouts> {
  const raw = asObj(rawSchedule);
  const tableId = str(asObj(raw?.scoreLocationPayoutTables)?.[loc.key]);
  return tableId ? parsePayouts(asObj(raw?.payoutTables)?.[tableId]) : [];
}

const titleCase = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s);

export function boardKind(loc: ScoreLocation, windowId: string): BoardKind {
  if (loc.group === 'cumulative') return 'cumulative';
  return loc.instance === windowId ? 'main' : 'tier';
}

/** "Bronze" from `S42_RankedCupSoloReload_Event8_NAW_2_Bronze`. */
export function boardLabel(loc: ScoreLocation, windowId: string): string {
  const kind = boardKind(loc, windowId);
  if (kind === 'main') return 'Overall';
  if (kind === 'cumulative') return 'Cumulative';
  const rest = loc.instance.startsWith(`${windowId}_`) ? loc.instance.slice(windowId.length + 1) : loc.instance;
  return titleCase(rest.replace(/^\d+_/, ''));
}

export function boardInfos(
  rawSchedule: unknown,
  eventId: string,
  windowId: string,
  templateRules?: unknown,
): BoardInfo[] {
  return windowLocations(rawSchedule, eventId, windowId).map((loc) => {
    const kind = boardKind(loc, windowId);
    const rules = boardRules(rawSchedule, loc, kind === 'main' ? templateRules : undefined);
    return {
      id: kind === 'cumulative' ? 'cumulative' : loc.instance,
      kind,
      label: boardLabel(loc, windowId),
      computed: kind === 'cumulative',
      hasPoints: rules.some((r) => r.tiers.some((t) => t.points > 0)),
      scoring: summarizeScoring(rules),
      payouts: boardPayouts(rawSchedule, loc),
    };
  });
}

/** Main board if it scores; otherwise the last tier Epic lists (the top tier for Ranked Cups). */
export function defaultBoard(boards: BoardInfo[]): string {
  const main = boards.find((b) => b.kind === 'main');
  if (main?.hasPoints) return main.id;
  const tiers = boards.filter((b) => b.kind === 'tier' && b.hasPoints);
  return tiers[tiers.length - 1]?.id ?? main?.id ?? boards[0]!.id;
}
