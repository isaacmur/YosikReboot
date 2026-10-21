// One tournament on Me and player pages, laid out like Osirion's: the team, rank,
// Top % and points with Epic's placement/elimination split, each player's stats
// from the games' replays (D31), then the team's numbers from Epic's leaderboard.

import { Link } from 'react-router';
import type { Entry } from '../../lib/types';
import { formatDuration, ordinal, TEAM_LABEL, topShare } from '../format';
import { ReplayStats } from './ReplayStats';
import { Panel } from './ui';

const fmt = (n: number) => n.toLocaleString('en-US');
const perGame = (n: number, games: number) =>
  games ? (Math.round((n / games) * 10) / 10).toLocaleString('en-US') : '—';

export function ResultCard({
  entry,
  me,
  teams,
  boardLabel,
}: {
  entry: Entry;
  /** The player whose page this is. */
  me: string;
  /** Teams on the board, for Top %; `atLeast` when there are more (boards past the top 10,000). */
  teams?: { teams: number; atLeast: boolean };
  boardLabel?: string;
}) {
  const size = entry.members.length;
  const mode = size >= 1 && size <= 4 ? TEAM_LABEL[size as 1 | 2 | 3 | 4] : undefined;
  const places = entry.sessions.map((s) => s.place).filter((p): p is number => p !== null);
  const alive = entry.sessions.reduce((n, s) => n + (s.timeAlive ?? 0), 0);
  const hasAlive = entry.sessions.some((s) => s.timeAlive !== null);
  const split = entry.pointSplit;
  const stats: [string, string][] = [
    ['Eliminations', fmt(entry.elims)],
    ['Games', fmt(entry.matches)],
    ['Wins', fmt(entry.victories)],
    ['Average placement', entry.avgPlace === null ? '—' : String(entry.avgPlace)],
    ['Best placement', places.length ? ordinal(Math.min(...places)) : '—'],
    ['Points per game', perGame(entry.points, entry.matches)],
    ['Eliminations per game', perGame(entry.elims, entry.matches)],
    ...(hasAlive ? [['Time alive', formatDuration(alive)] as [string, string]] : []),
  ];

  return (
    <div className="space-y-3">
      <Panel className="overflow-hidden">
        <div className="flex divide-x divide-line border-b border-line">
          {entry.members.map((m) => (
            <div key={m.id} className="min-w-0 flex-1 px-3 py-2 text-center text-sm">
              {m.id === me ? (
                <span className="block truncate font-bold">{m.name ?? 'You'}</span>
              ) : (
                <Link to={`/players/${m.id}`} className="block truncate font-semibold text-muted hover:text-ink">
                  {m.name ?? `${m.id.slice(0, 6)}…`}
                </Link>
              )}
            </div>
          ))}
        </div>
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-display text-3xl leading-none font-bold">
              Rank #{fmt(entry.rank)}
              {teams ? (
                <span className="ml-2 text-lg text-muted">
                  {topShare(entry.rank, teams.teams).replace('Top ', teams.atLeast ? 'Top <' : 'Top ')}
                </span>
              ) : null}
            </p>
            <p className="nums font-display text-3xl leading-none font-bold">
              {fmt(entry.points)} <span className="text-lg">points</span>
            </p>
          </div>
          {split && (
            <dl className="nums mt-3 space-y-1 border-t border-line pt-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Placement</dt>
                <dd>{fmt(split.placement)} points</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Elimination</dt>
                <dd>{fmt(split.elims)} points</dd>
              </div>
              {split.other > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">Other</dt>
                  <dd>{fmt(split.other)} points</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </Panel>

      <ReplayStats entry={entry} me={me} />

      <Panel className="overflow-hidden">
        <table className="nums w-full text-sm">
          <caption className="sr-only">Tournament stats</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-4 py-2 font-semibold">Stat</th>
              <th className="px-4 py-2 text-right font-semibold">
                {size > 1 ? 'Team' : 'You'}
                {mode && <span className="ml-1.5 text-xs font-normal text-faint">{mode}</span>}
                {boardLabel && boardLabel !== 'Overall' && (
                  <span className="ml-1.5 text-xs font-normal text-faint">{boardLabel}</span>
                )}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stats.map(([k, v]) => (
              <tr key={k}>
                <td className="px-4 py-1.5 text-muted">{k}</td>
                <td className="px-4 py-1.5 text-right font-semibold">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="text-[11px] text-faint">
        The table above is Epic's leaderboard, per {size > 1 ? 'team' : 'player'}. Healing, headshots and edits aren't
        in the replay data this app reads.
      </p>
    </div>
  );
}
