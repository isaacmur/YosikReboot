// What a finish earned (F23), from the board's payout tiers. Within one payout
// table a rank (or top fraction) earns its nearest tier at or after it, so 6th
// in a "1st, 2nd, … 5th, 8th" table gets the 8th-place prize; points tiers all
// pay once reached. Tiers at 0 points are entry and lockout tokens, not prizes.

import type { PayoutTier } from '../lib/types';

export interface Prize {
  /** Cash as Epic lists it for the place, in US dollars. */
  usd: number;
  /** "Qualifies for …" rewards. */
  qualifies: string[];
  /** Everything else: cosmetics and non-USD cash. */
  items: string[];
}

const QUALIFIES = /^Qualifies for /;
const USD = /^\$[\d,]+$/;

export function prizeFor(rank: number, points: number, tiers: PayoutTier[], teams?: number): Prize {
  const won: PayoutTier[] = [];
  for (const table of new Set(tiers.map((t) => t.table))) {
    const mine = tiers.filter((t) => t.table === table);
    const nearest = (basis: PayoutTier['basis'], at: number) =>
      mine.filter((t) => t.basis === basis && t.threshold >= at).sort((a, b) => a.threshold - b.threshold)[0];
    const byRank = nearest('rank', rank);
    if (byRank) won.push(byRank);
    if (teams) {
      const byShare = nearest('percentile', rank / teams);
      if (byShare) won.push(byShare);
    }
    won.push(...mine.filter((t) => t.basis === 'points' && t.threshold > 0 && points >= t.threshold));
  }
  const rewards = [...new Set(won.flatMap((t) => t.rewards))];
  return {
    usd: won.reduce((sum, t) => sum + t.usd, 0),
    qualifies: rewards.filter((r) => QUALIFIES.test(r)),
    items: rewards.filter((r) => !QUALIFIES.test(r) && !USD.test(r)),
  };
}

export const formatUsd = (usd: number) => `$${usd.toLocaleString('en-US')}`;
