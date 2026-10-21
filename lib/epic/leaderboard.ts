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
          endedAt: str(s.endTime) ?? '',
          place,
          elims: num(stats[names.elims]) ?? num(stats.TEAM_ELIMS_STAT_INDEX) ?? 0,
          points: rules.length ? sessionPoints(stats, rules) : null,
          victory: num(stats[names.victory]) === 1 || place === 1,
        };
      })
      .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
    out.push({
      rank,
      teamKey: teamKeyOf(ids),
      members: ids.map((id) => ({ id })),
      points: num(o.pointsEarned) ?? 0,
      ...summarize(sessions),
      sessions,
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

/** Drops names and match details, for page scans that only need ranks and IDs. */
export const liteEntry = (e: Entry): Entry => ({ ...e, members: e.members.map(({ id }) => ({ id })), sessions: [] });
