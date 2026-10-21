// Per-game views (D28): a team's games with placement, eliminations, points and
// time alive, each opening that game; one game's teams by placement; and a
// session's games, lobby by lobby, for set lobbies.

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { MatchResult } from '../../lib/types';
import { formatTime, plural } from '../format';
import { formatAlive, type Lobby, type Match } from '../matches';
import { ChevronRight, StarIcon } from './icons';
import { Chip, Panel } from './ui';

const TH = 'pb-1 font-semibold';

/** A team's games, oldest first. Each opens its game through `onGame` or `gameHref`. */
export function GamesTable({
  sessions,
  tz,
  onGame,
  gameHref,
}: {
  sessions: MatchResult[];
  tz: string;
  onGame?: (sessionId: string) => void;
  gameHref?: (sessionId: string) => string;
}) {
  const open = (s: MatchResult, children: ReactNode) => {
    if (!s.sessionId) return children;
    if (gameHref)
      return (
        <Link to={gameHref(s.sessionId)} className="text-accent-bright hover:underline">
          {children}
        </Link>
      );
    if (onGame)
      return (
        <button onClick={() => onGame(s.sessionId)} className="text-accent-bright hover:underline">
          {children}
        </button>
      );
    return children;
  };
  return (
    <table className="nums w-full max-w-md text-xs">
      <caption className="sr-only">Games</caption>
      <thead className="text-faint">
        <tr className="text-[10px] tracking-wider uppercase">
          <th className={`${TH} text-left`}>Game</th>
          <th className={`${TH} text-right`}>Place</th>
          <th className={`${TH} text-right`}>Elims</th>
          <th className={`${TH} text-right`}>Pts</th>
          <th className={`${TH} text-right`}>Alive</th>
          <th className={`${TH} text-right`}>Ended</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s, i) => (
          <tr key={`${s.sessionId || s.endedAt}-${i}`} className="border-t border-line/70">
            <td className="py-1 font-semibold">{open(s, `Game ${i + 1}`)}</td>
            <td className={`py-1 text-right ${s.victory ? 'font-bold text-accent-bright' : ''}`}>
              {s.place ? (s.victory ? 'Win' : `#${s.place}`) : '—'}
            </td>
            <td className="py-1 text-right">{s.elims}</td>
            <td className="py-1 text-right font-semibold">{s.points ?? '—'}</td>
            <td className="py-1 text-right text-muted">{formatAlive(s.timeAlive)}</td>
            <td className="py-1 text-right text-muted">{s.endedAt ? formatTime(s.endedAt, tz) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const names = (t: Match['teams'][number]) => t.entry.members.map((m) => m.name ?? `${m.id.slice(0, 6)}…`).join(' / ');

/** One game: every team in it on these rows, by placement. */
export function MatchTable({
  match,
  followSet,
  teamNames,
}: {
  match: Match;
  followSet: Set<string>;
  teamNames: Map<string, string>;
}) {
  return (
    <Panel className="overflow-x-auto">
      <table className="nums w-full text-sm">
        <caption className="sr-only">Teams in this game by placement</caption>
        <thead>
          <tr className="border-b border-line text-[10px] tracking-wider text-faint uppercase">
            <th className="px-3 py-2 text-left font-semibold">Place</th>
            <th className="px-3 py-2 text-left font-semibold">Team</th>
            <th className="px-3 py-2 text-right font-semibold">Elims</th>
            <th className="px-3 py-2 text-right font-semibold">Pts</th>
            <th className="px-3 py-2 text-right font-semibold">Alive</th>
            <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Rank</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {match.teams.map((t) => {
            const followed = t.entry.members.some((m) => followSet.has(m.id));
            const team = teamNames.get(t.entry.teamKey);
            return (
              <tr key={t.entry.teamKey} className={followed || team ? 'bg-accent-soft' : ''}>
                <td className={`px-3 py-2 font-bold ${t.result.victory ? 'text-accent-bright' : ''}`}>
                  {t.result.place ? (t.result.victory ? 'Win' : `#${t.result.place}`) : '—'}
                </td>
                <td className="max-w-[12rem] px-3 py-2 sm:max-w-none">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {followed && <StarIcon size={12} className="shrink-0 fill-accent text-accent" />}
                    {team && <Chip tone="accent">{team}</Chip>}
                    <span className="truncate font-semibold">{names(t)}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{t.result.elims}</td>
                <td className="px-3 py-2 text-right font-semibold">{t.result.points ?? '—'}</td>
                <td className="px-3 py-2 text-right text-muted">{formatAlive(t.result.timeAlive)}</td>
                <td className="hidden px-3 py-2 text-right text-muted sm:table-cell">{t.entry.rank}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

/** A set-lobby session's games, lobby by lobby. */
export function MatchList({
  lobbies,
  tz,
  matchHref,
}: {
  lobbies: Lobby[];
  tz: string;
  matchHref: (id: string) => string;
}) {
  return (
    <div className="space-y-5">
      {lobbies.map((l) => (
        <section key={l.n}>
          {lobbies.length > 1 && (
            <h3 className="mb-2 font-display text-lg leading-none font-bold tracking-wide uppercase">
              Lobby {l.n} <span className="text-sm font-semibold text-faint">· {plural(l.teams, 'team')}</span>
            </h3>
          )}
          <Panel className="divide-y divide-line overflow-hidden">
            {l.matches.map((m, i) => {
              const winner = m.teams[0];
              const fragger = [...m.teams].sort((a, b) => b.result.elims - a.result.elims)[0];
              return (
                <Link
                  key={m.id}
                  to={matchHref(m.id)}
                  replace
                  className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-raised/60"
                >
                  <span className="nums w-6 shrink-0 text-center font-display text-xl leading-none font-bold">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {winner?.result.victory ? `Won by ${names(winner)}` : `Game ${i + 1}`}
                    </span>
                    <span className="nums block truncate text-xs text-muted">
                      Ended {formatTime(m.endedAt, tz)} · {plural(m.teams.length, 'team')}
                      {fragger && fragger.result.elims > 0
                        ? ` · most elims ${names(fragger)} (${fragger.result.elims})`
                        : ''}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-faint" />
                </Link>
              );
            })}
          </Panel>
        </section>
      ))}
    </div>
  );
}
