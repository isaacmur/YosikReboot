// Epic's scoring and payout rules. Verified against the live capture: summing
// these rules over each match's tracked stats reproduces Epic's `pointsEarned`
// for every entry (main boards and Ranked Cup tier boards alike).

import type { PayoutTier, ScoringSummary } from '../types.js';
import { humanize } from './events.js';
import { asArr, asObj, num, str } from './json.js';

export interface ScoringRule {
  stat: string;
  match: 'lte' | 'gte';
  tiers: { key: number; points: number; multiplicative: boolean }[];
}

export function parseRules(raw: unknown): ScoringRule[] {
  const out: ScoringRule[] = [];
  for (const r of asArr(raw)) {
    const o = asObj(r);
    const stat = str(o?.trackedStat);
    const match = o?.matchRule === 'lte' || o?.matchRule === 'gte' ? o.matchRule : undefined;
    if (!stat || !match) continue;
    const tiers = asArr(o?.rewardTiers)
      .map(asObj)
      .map((t) => ({ key: num(t?.keyValue), points: num(t?.pointsEarned), multiplicative: t?.multiplicative === true }))
      .filter(
        (t): t is { key: number; points: number; multiplicative: boolean } =>
          t.key !== undefined && t.points !== undefined,
      );
    out.push({ stat, match, tiers });
  }
  return out;
}

/** Each tier pays when the stat is at or better than its key: <= for places, >= for eliminations. */
export function sessionPoints(stats: Record<string, unknown>, rules: ScoringRule[]): number {
  let total = 0;
  for (const r of rules) {
    const v = num(stats[r.stat]);
    if (v === undefined) continue;
    for (const t of r.tiers) {
      if (r.match === 'lte' ? v <= t.key : v >= t.key) total += t.multiplicative ? t.points * v : t.points;
    }
  }
  return total;
}

/** Stat names this board scores on; Ranked Cup tier boards use tier-prefixed stats. */
export function statNames(rules: ScoringRule[]): { place: string; elims: string; victory: string } {
  const place = rules.find((r) => r.stat.endsWith('PLACEMENT_STAT_INDEX'))?.stat ?? 'PLACEMENT_STAT_INDEX';
  const elims = rules.find((r) => r.stat.endsWith('TEAM_ELIMS_STAT_INDEX'))?.stat ?? 'TEAM_ELIMS_STAT_INDEX';
  return { place, elims, victory: place.replace(/PLACEMENT_STAT_INDEX$/, 'VICTORY_ROYALE_STAT') };
}

/** Evaluates the rules at every threshold, so the UI can show "1st: 51 pts" instead of tier maths. */
export function summarizeScoring(rules: ScoringRule[]): ScoringSummary | null {
  const { place, elims } = statNames(rules);
  const maxKey = (stat: string) =>
    Math.max(0, ...rules.filter((r) => r.stat === stat).flatMap((r) => r.tiers.map((t) => t.key)));
  const placement = [];
  for (let p = 1; p <= Math.min(maxKey(place), 1000); p++) {
    const points = sessionPoints({ [place]: p }, rules);
    if (points > 0) placement.push({ place: p, points });
  }
  const elimRows = [];
  for (let e = 1; e <= Math.min(maxKey(elims), 100); e++) {
    const points = sessionPoints({ [elims]: e }, rules);
    if (points > 0) elimRows.push({ elims: e, points });
  }
  return placement.length || elimRows.length ? { placement, elims: elimRows } : null;
}

const BASIS: Record<string, PayoutTier['basis']> = { rank: 'rank', percentile: 'percentile', value: 'points' };

function rewardLabel(p: Record<string, unknown>): string | undefined {
  const type = str(p.rewardType);
  const value = str(p.value) ?? '';
  const qty = num(p.quantity) ?? 1;
  if (type === 'ecomm')
    return value === 'USD' ? `$${qty.toLocaleString('en-US')}` : `${qty.toLocaleString('en-US')} ${value}`;
  if (type === 'token') return `Qualifies for ${humanize(value.replace(/^S\d+_/, ''))}`;
  if (type === 'game') return humanize((value.split(':')[0] ?? value).replace(/^Athena/, '')) || 'In-game reward';
  return undefined;
}

export function parsePayouts(raw: unknown): PayoutTier[] {
  const out: PayoutTier[] = [];
  for (const table of asArr(raw)) {
    const t = asObj(table);
    const basis = BASIS[str(t?.scoringType) ?? ''];
    if (!basis) continue;
    for (const rank of asArr(t?.ranks)) {
      const r = asObj(rank);
      const threshold = num(r?.threshold);
      if (threshold === undefined) continue;
      const payouts = asArr(r?.payouts)
        .map(asObj)
        .filter((p): p is Record<string, unknown> => !!p);
      const rewards = [...new Set(payouts.map(rewardLabel).filter((l): l is string => !!l))];
      if (rewards.length)
        out.push({ basis, threshold, rewards, qualifies: payouts.some((p) => p.rewardType === 'token') });
    }
  }
  return out.sort((a, b) => (a.basis === b.basis ? a.threshold - b.threshold : a.basis.localeCompare(b.basis)));
}
