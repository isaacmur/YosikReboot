// A board's scoring table and prizes (F21), shown beside the leaderboard on
// desktop, in a sheet on phones, and on the Rules tab.

import { useState } from 'react';
import type { BoardInfo, PayoutTier } from '../../lib/types';
import { ordinal } from '../format';
import { Chip, Empty, Panel } from './ui';

const fmtN = (n: number) => n.toLocaleString('en-US');

const PLACES_SHOWN = 12;

export function ScoringPanel({ board }: { board: BoardInfo }) {
  const [all, setAll] = useState(false);
  const s = board.scoring;
  if (!s) return <Empty>Epic doesn't publish points for this board.</Empty>;
  const first = s.elims[0];
  const perElim = first && s.elims.every((r) => r.points === r.elims * first.points);
  // Neighbouring places worth the same points share a tile ("11th–15th").
  const places: { from: number; to: number; points: number }[] = [];
  for (const p of s.placement) {
    const last = places[places.length - 1];
    if (last && last.points === p.points && last.to === p.place - 1) last.to = p.place;
    else places.push({ from: p.place, to: p.place, points: p.points });
  }
  return (
    <Panel className="p-4">
      <h3 className="font-display text-sm font-bold tracking-wider text-muted uppercase">Placement points</h3>
      <ul className="nums mt-2 grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-1.5">
        {(all ? places : places.slice(0, PLACES_SHOWN)).map((p) => (
          <li key={p.from} className="rounded-md bg-raised px-2 py-1.5 text-center">
            <span className="block text-[11px] text-faint">
              {p.from === p.to ? ordinal(p.from) : `${ordinal(p.from)}–${ordinal(p.to)}`}
            </span>
            <span className="font-display text-lg leading-none font-bold">{p.points}</span>
          </li>
        ))}
      </ul>
      {places.length > PLACES_SHOWN && (
        <button onClick={() => setAll(!all)} className="mt-2 text-xs font-semibold text-accent-bright hover:underline">
          {all ? 'Show fewer' : `Show all ${places.length}`}
        </button>
      )}
      {s.elims.length > 0 && (
        <>
          <h3 className="mt-4 font-display text-sm font-bold tracking-wider text-muted uppercase">Eliminations</h3>
          <p className="mt-1 text-sm">
            {perElim
              ? `${first.points} point${first.points === 1 ? '' : 's'} per elimination${s.elims.length < 100 ? `, up to ${s.elims.length}` : ''}`
              : s.elims.map((r) => `${r.elims}: ${r.points}`).join(' · ')}
          </p>
        </>
      )}
    </Panel>
  );
}

const payoutLabel = (p: PayoutTier) =>
  p.basis === 'rank'
    ? `Top ${fmtN(p.threshold)}`
    : p.basis === 'percentile'
      ? `Top ${+(p.threshold * 100).toFixed(2)}%`
      : `${fmtN(p.threshold)} points`;

export function PrizesPanel({ board }: { board: BoardInfo }) {
  if (!board.payouts.length) return <Empty>No prizes listed for this board.</Empty>;
  return (
    // One line per tier where there's room; in the narrow side panel the rewards drop below.
    <Panel className="@container overflow-hidden">
      <ul className="divide-y divide-line">
        {board.payouts.map((p) => (
          <li
            key={`${p.basis}${p.threshold}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm @sm:grid-cols-[7rem_minmax(0,1fr)_auto]"
          >
            <span className="nums font-display text-base font-bold tracking-wide uppercase">{payoutLabel(p)}</span>
            <span className="order-last col-span-2 text-muted @sm:order-none @sm:col-span-1">
              {p.rewards.join(', ')}
            </span>
            <span>{p.qualifies && <Chip tone="accent">Qualifies</Chip>}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
