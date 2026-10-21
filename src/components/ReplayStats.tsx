// Per-player stats from a tournament's replays (D31), you and your teammates side
// by side like Osirion's: eliminations and knocks from every game's elimination
// feed, and damage, accuracy and materials where the replays carry each
// player's match stats. Replays are read when shown and kept for good.

import type { Entry } from '../../lib/types';
import { plural } from '../format';
import { useReplayTotals, type PlayerReplayStats } from '../replays';
import { Panel } from './ui';

type Row = [
  label: string,
  value: (p: PlayerReplayStats) => number | null,
  format: (n: number) => string,
  high: boolean,
];

const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
const n2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US');
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString('en-US')}%`;

const FEED_ROWS: Row[] = [
  ['Eliminations', (p) => p.eliminations, n0, true],
  ['Knocks', (p) => p.knocks, n0, true],
  ['Times knocked', (p) => p.knocked, n0, false],
  ['K/D ratio', (p) => p.eliminations / Math.max(1, p.deaths), n2, true],
];
const STATS_ROWS: Row[] = [
  ['Damage to players', (p) => (p.statsGames ? p.damageToPlayers : null), n0, true],
  ['Damage from players', (p) => (p.statsGames ? p.damageTaken : null), n0, false],
  ['Damage ratio', (p) => (p.statsGames && p.damageTaken ? p.damageToPlayers / p.damageTaken : null), n2, true],
  ['Accuracy', (p) => p.accuracy, pct, true],
  ['Mats farmed', (p) => (p.statsGames ? p.materialsGathered : null), n0, true],
  ['Mats used', (p) => (p.statsGames ? p.materialsUsed : null), n0, true],
  ['Damage to builds', (p) => (p.statsGames ? p.damageToStructures : null), n0, true],
  ['Revives', (p) => (p.statsGames ? p.revives : null), n0, true],
];

export function ReplayStats({ entry, me }: { entry: Entry; me: string }) {
  const matchIds = entry.sessions.map((s) => s.sessionId).filter(Boolean);
  const members = [...entry.members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  const players = members.map((m) => m.id);
  const { totals, progress, error } = useReplayTotals(matchIds, players);
  if (!matchIds.length) return null;

  const withStats = players.some((p) => (totals.byPlayer.get(p)?.statsGames ?? 0) > 0);
  const rows = totals.read ? [...FEED_ROWS, ...(withStats ? STATS_ROWS : [])] : [];
  const status = progress
    ? `Reading this tournament's replays: ${progress.done} of ${progress.total}…`
    : `Replays read for ${totals.read} of ${plural(matchIds.length, 'game')}` +
      (totals.gone ? ` · ${totals.gone} gone (Epic keeps them about one to two weeks)` : '');

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <Panel className="overflow-x-auto">
          <table className="nums w-full text-xs sm:text-sm">
            <caption className="sr-only">Per-player stats from the replays</caption>
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 py-2 text-left font-semibold sm:px-4">Stat</th>
                {members.map((m) => (
                  <th
                    key={m.id}
                    className={`px-2 py-2 text-right font-semibold sm:px-4 ${m.id === me ? 'bg-accent-soft' : 'text-muted'}`}
                  >
                    <span className="inline-block max-w-[6rem] truncate align-bottom sm:max-w-[9rem]">
                      {m.name ?? `${m.id.slice(0, 6)}…`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(([label, value, format, high]) => {
                const values = players.map((p) => value(totals.byPlayer.get(p)!));
                const known = values.filter((v): v is number => v !== null);
                const best = known.length > 1 ? (high ? Math.max(...known) : Math.min(...known)) : null;
                return (
                  <tr key={label}>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted sm:px-4">{label}</td>
                    {values.map((v, i) => (
                      <td
                        key={players[i]}
                        className={`px-2 py-1.5 text-right font-semibold sm:px-4 ${players[i] === me ? 'bg-accent-soft' : ''} ${
                          v !== null && v === best && known.some((k) => k !== best) ? 'text-accent-bright' : ''
                        }`}
                      >
                        {v === null ? '—' : format(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
      <p className="text-[11px] text-faint" role="status">
        {status}
        {error && ` · stopped: ${error}`}
        {totals.read > 0 && !withStats && totals.statsEvents > 0 && (
          <>
            {' '}
            · the replays had {plural(totals.statsEvents, 'stats event')}, {totals.namedStats} naming a player, so
            damage, accuracy and materials aren't shown
          </>
        )}
        {totals.read > 0 &&
          !withStats &&
          totals.statsEvents === 0 &&
          ' · no per-player damage or accuracy in these replays'}
      </p>
      {totals.read > 0 && (
        <details className="text-[11px] text-faint">
          <summary className="cursor-pointer font-semibold text-accent-bright">What the replays held</summary>
          <p className="mt-1 break-words">
            {Object.entries(totals.events)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => `${k} ×${n}`)
              .join(' · ') || 'No events'}
          </p>
          {totals.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </details>
      )}
    </div>
  );
}
