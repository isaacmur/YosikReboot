// Epic's scoring and payout rules. Verified against the live capture: summing
// these rules over each match's tracked stats reproduces Epic's `pointsEarned`
// for every entry (main boards and Ranked Cup tier boards alike).

import type { Cutoff, PayoutTier, ScoringSummary } from '../types.js';
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
  // A multiplicative tier ("2 points per elimination") has no top, so count up to 100.
  const uncapped = rules.some((r) => r.stat === elims && r.tiers.some((t) => t.multiplicative));
  const elimRows = [];
  for (let e = 1; e <= (uncapped ? 100 : Math.min(maxKey(elims), 100)); e++) {
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

interface Tier {
  basis: PayoutTier['basis'];
  threshold: number;
  table: number;
  rewards: string[];
  /** Labels of the qualification rewards ("Qualifies for …"). */
  qualifyTo: string[];
  cash: boolean;
  usd: number;
}

function parseTiers(raw: unknown): Tier[] {
  const out: Tier[] = [];
  for (const [table, entry] of asArr(raw).entries()) {
    const t = asObj(entry);
    const basis = BASIS[str(t?.scoringType) ?? ''];
    if (!basis) continue;
    for (const rank of asArr(t?.ranks)) {
      const r = asObj(rank);
      const threshold = num(r?.threshold);
      if (threshold === undefined) continue;
      const payouts = asArr(r?.payouts)
        .map(asObj)
        .filter((p): p is Record<string, unknown> => !!p);
      const labels = (type?: string) =>
        [...new Set(payouts.filter((p) => !type || p.rewardType === type).map(rewardLabel))].filter(
          (l): l is string => !!l,
        );
      const rewards = labels();
      if (rewards.length)
        out.push({
          basis,
          threshold,
          table,
          rewards,
          qualifyTo: labels('token'),
          cash: payouts.some((p) => p.rewardType === 'ecomm'),
          usd: payouts
            .filter((p) => p.rewardType === 'ecomm' && p.value === 'USD')
            .reduce((sum, p) => sum + (num(p.quantity) ?? 0), 0),
        });
    }
  }
  return out.sort((a, b) => (a.basis === b.basis ? a.threshold - b.threshold : a.basis.localeCompare(b.basis)));
}

export function parsePayouts(raw: unknown): PayoutTier[] {
  return parseTiers(raw).map(({ basis, threshold, table, rewards, qualifyTo, usd }) => ({
    basis,
    threshold,
    table,
    rewards,
    qualifies: qualifyTo.length > 0,
    usd,
  }));
}

const KIND_ORDER: Cutoff['kind'][] = ['qualify', 'cash', 'item'];

/**
 * Lines to draw on a board: for each next round, the furthest tier that qualifies
 * for it; the last paid tier; and each tier of items. "Furthest" is the highest rank
 * or fraction, or the lowest points total. Points tiers at 0 are entry and lockout
 * tokens that everyone who plays gets, so they draw no line.
 */
export function parseCutoffs(raw: unknown): Cutoff[] {
  const best = new Map<string, Cutoff>();
  const keep = (c: Cutoff) => {
    const key = `${c.basis}|${c.kind}|${c.kind === 'item' ? c.threshold : c.label}`;
    const prev = best.get(key);
    const further = !prev || (c.basis === 'points' ? c.threshold < prev.threshold : c.threshold > prev.threshold);
    if (further) best.set(key, c);
  };
  for (const t of parseTiers(raw)) {
    if (t.basis === 'points' && t.threshold <= 0) continue;
    for (const label of t.qualifyTo) keep({ basis: t.basis, threshold: t.threshold, kind: 'qualify', label });
    if (t.cash) keep({ basis: t.basis, threshold: t.threshold, kind: 'cash', label: 'Cash prizes' });
    if (!t.cash && !t.qualifyTo.length)
      keep({ basis: t.basis, threshold: t.threshold, kind: 'item', label: t.rewards.join(', ') });
  }
  // Two rounds reached from the same place share one line.
  const lines = new Map<string, Cutoff>();
  for (const c of best.values()) {
    const key = `${c.basis}|${c.kind}|${c.threshold}`;
    const prev = lines.get(key);
    lines.set(key, prev ? { ...prev, label: `${prev.label}; ${c.label}` } : c);
  }
  return [...lines.values()].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.basis.localeCompare(b.basis) ||
      a.threshold - b.threshold,
  );
}
