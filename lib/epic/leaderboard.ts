// Turns one Epic leaderboard page into Entry rows, scoring each match with the
// board's own rules, and merges session boards into a cumulative standing (D7).

import type { Entry, MatchResult } from '../types.js';
import { asArr, asObj, num, str, strings } from './json.js';
import { sessionPoints, statNames, type ScoringRule } from './scoring.js';

export const teamKeyOf = (ids: string[]) => [...ids].sort().join(':');

function summarize(sessions: MatchResult[]): Pick<Entry, 'matches' | 'victories' | 'elims' | 'avgPlace'> {
  const places = sessions.map((s) => s.place).filter((p): p is number => p !== null);
  return {
    matches: sessions.length,
    victories: sessions.filter((s) => s.victory).length,
    elims: sessions.reduce((n, s) => n + s.elims, 0),
    avgPlace: places.length ? Math.round((places.reduce((a, b) => a + b, 0) / places.length) * 10) / 10 : null,
  };
}

/**
 * Epic's own split of a team's points (`pointBreakdown`, keyed "STAT:value"):
 * placement, eliminations (tier-prefixed on Ranked Cup boards) and anything else.
 */
export function pointSplit(raw: unknown): Entry['pointSplit'] {
  const breakdown = asObj(raw);
  if (!breakdown) return undefined;
  const split = { placement: 0, elims: 0, other: 0 };
  for (const [key, v] of Object.entries(breakdown)) {
    const points = num(asObj(v)?.pointsEarned) ?? 0;
    const stat = key.split(':')[0] ?? '';
    if (/PLACEMENT_STAT_INDEX$/.test(stat)) split.placement += points;
    else if (/ELIMS_STAT_INDEX$/.test(stat)) split.elims += points;
    else split.other += points;
  }
  return split;
}

const addSplits = (a: Entry['pointSplit'], b: Entry['pointSplit']): Entry['pointSplit'] =>
  a && b ? { placement: a.placement + b.placement, elims: a.elims + b.elims, other: a.other + b.other } : undefined;

export function normalizeEntries(rawPage: unknown, rules: ScoringRule[]): Entry[] {
  const names = statNames(rules);
  const out: Entry[] = [];
  for (const e of asArr(asObj(rawPage)?.entries)) {
    const o = asObj(e);
    const ids = strings(o?.teamAccountIds);
    const rank = num(o?.rank);
    if (!o || !ids.length || rank === undefined) continue;
    const sessions: MatchResult[] = asArr(o.sessionHistory)
      .map(asObj)
      .filter((s): s is Record<string, unknown> => !!s)
      .map((s) => {
        const stats = asObj(s.trackedStats) ?? {};
        const place = num(stats[names.place]) ?? num(stats.PLACEMENT_STAT_INDEX) ?? null;
        return {
          sessionId: str(s.sessionId) ?? '',
          endedAt: str(s.endTime) ?? '',
          place,
          elims: num(stats[names.elims]) ?? num(stats.TEAM_ELIMS_STAT_INDEX) ?? 0,
          points: rules.length ? sessionPoints(stats, rules) : null,
          victory: num(stats[names.victory]) === 1 || place === 1,
          timeAlive: num(stats[names.alive]) ?? num(stats.TIME_ALIVE_STAT) ?? null,
        };
      })
      .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
    const split = pointSplit(o.pointBreakdown);
    out.push({
      rank,
      teamKey: teamKeyOf(ids),
      members: ids.map((id) => ({ id })),
      points: num(o.pointsEarned) ?? 0,
      ...summarize(sessions),
      sessions,
      ...(split ? { pointSplit: split } : {}),
    });
  }
  return out;
}

/** Sums several session boards by team and re-ranks (ties share a rank). */
export function mergeCumulative(boards: Entry[][]): Entry[] {
  const byTeam = new Map<string, Entry>();
  for (const board of boards) {
    for (const e of board) {
      const prev = byTeam.get(e.teamKey);
      if (!prev) byTeam.set(e.teamKey, { ...e, sessions: [...e.sessions] });
      else {
        prev.points += e.points;
        prev.sessions.push(...e.sessions);
        prev.pointSplit = addSplits(prev.pointSplit, e.pointSplit);
      }
    }
  }
  const merged = [...byTeam.values()].map((e) => {
    const sessions = e.sessions.sort((a, b) => a.endedAt.localeCompare(b.endedAt));
    return { ...e, sessions, ...summarize(sessions) };
  });
  merged.sort((a, b) => b.points - a.points || b.victories - a.victories || (a.avgPlace ?? 999) - (b.avgPlace ?? 999));
  merged.forEach((e, i) => (e.rank = i > 0 && merged[i - 1]!.points === e.points ? merged[i - 1]!.rank : i + 1));
  return merged;
}

/**
 * Drops names and match details, for page scans that only need ranks and IDs,
 * keeping each game's points so placement after each game can be worked out (D29).
 */
export function liteEntry(e: Entry): Entry {
  const points = e.sessions.map((s) => s.points);
  const lite: Entry = { ...e, members: e.members.map(({ id }) => ({ id })), sessions: [] };
  if (points.every((p) => p !== null)) lite.gamePoints = points as number[];
  return lite;
}
