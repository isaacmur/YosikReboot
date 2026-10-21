// A set-lobby session's games (D28): each lobby's games in order, each opening
// onto every team's placement, eliminations, points and time alive. Reads the
// board's first pages (finals and most heats fit), more on request, and re-reads
// them on the board's schedule while the session is live.

import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { BoardInfo, EventWindow, LeaderboardPage, WindowState } from '../../lib/types';
import { boardRows, PAGE_SIZE } from '../board';
import { CONCURRENCY, readPage, runPool } from '../boardIndex';
import { formatTime, plural } from '../format';
import { useFollows } from '../follows';
import { useLive } from '../live';
import { isSetLobby, lobbiesOf } from '../matches';
import { useSettings } from '../settings';
import { useTeams } from '../teams';
import { ChevronLeft, ChevronRight } from './icons';
import { MatchList, MatchTable } from './MatchView';
import { Button, Empty, ErrorNote, ListSkeleton } from './ui';

/** Pages read at first, and at most. */
const FIRST_PAGES = 5;
const MAX_PAGES = 20;

interface Read {
  pages: Record<number, LeaderboardPage>;
  totalPages: number;
  setLobby: boolean;
}

export function MatchesTab({
  eventId,
  w,
  board,
  state,
}: {
  eventId: string;
  w: EventWindow;
  board: BoardInfo;
  state: WindowState;
}) {
  const [{ timeZone, refreshSec }] = useSettings();
  const follows = useFollows();
  const teams = useTeams();
  const followSet = useMemo(() => new Set(follows.map((f) => f.id)), [follows]);
  const teamNames = useMemo(() => new Map(teams.map((t) => [t.key, t.name])), [teams]);
  const [want, setWant] = useState(FIRST_PAGES);
  const wantRef = useRef(want);
  wantRef.current = want;

  const live = useLive<Read>(
    `${eventId}|${w.id}|${board.id}`,
    async () => {
      const q = { event: eventId, window: w.id, board: board.id };
      const first = await readPage({ ...q, page: 0 });
      const pages: Record<number, LeaderboardPage> = { 0: first };
      // Open sessions stop here: their games are spread across the whole board.
      const setLobby = isSetLobby(first.entries);
      if (setLobby) {
        const rest = Array.from({ length: Math.min(first.totalPages, wantRef.current) - 1 }, (_, i) => i + 1);
        await runPool(rest, CONCURRENCY, async (page) => {
          pages[page] = await readPage({ ...q, page });
        });
      }
      return { pages, totalPages: first.totalPages, setLobby };
    },
    state,
    refreshSec * 1000,
  );

  const data = live.data;
  const rows = useMemo(() => (data ? boardRows(data.pages).map((r) => r.entry) : []), [data]);
  const lobbies = useMemo(() => lobbiesOf(rows), [rows]);
  const [params] = useSearchParams();
  const matchId = params.get('match');
  const href = (id?: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'matches');
    if (id) next.set('match', id);
    else next.delete('match');
    return `?${next}`;
  };

  if (!data) return live.error ? <ErrorNote error={live.error} onRetry={live.refresh} /> : <ListSkeleton rows={6} />;
  if (!data.setLobby)
    return (
      <Empty>
        Teams in this session play in open lobbies with teams from all over the board, so there's no lobby to list. Open
        a team on the leaderboard to see each of its games.
      </Empty>
    );
  if (!lobbies.length) return <Empty>No games yet. Each one shows here once it ends.</Empty>;

  const loaded = Object.keys(data.pages).length;
  const partial = loaded < data.totalPages;
  const games = lobbies.reduce((n, l) => n + l.matches.length, 0);

  if (matchId) {
    const lobby = lobbies.find((l) => l.matches.some((m) => m.id === matchId));
    const i = lobby?.matches.findIndex((m) => m.id === matchId) ?? -1;
    const match = lobby?.matches[i];
    const back = (
      <Link
        to={href()}
        replace
        className="inline-flex items-center gap-1 text-sm font-semibold text-accent-bright hover:underline"
      >
        <ChevronLeft size={15} /> All games
      </Link>
    );
    if (!lobby || !match)
      return (
        <div className="space-y-3">
          {back}
          <Empty>That game isn't in this session's results.</Empty>
        </div>
      );
    const prev = lobby.matches[i - 1];
    const next = lobby.matches[i + 1];
    const step = 'inline-flex items-center gap-1 text-sm font-semibold text-accent-bright hover:underline';
    return (
      <div className="space-y-3">
        {back}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-display text-2xl leading-none font-bold tracking-wide uppercase">
              {lobbies.length > 1 && `Lobby ${lobby.n} · `}Game {i + 1}
            </h3>
            <p className="nums mt-1 text-xs text-muted">
              Ended {formatTime(match.endedAt, timeZone)} · {plural(match.teams.length, 'team')}
              {partial && ` in the top ${(loaded * PAGE_SIZE).toLocaleString('en-US')}`}
            </p>
          </div>
          <span className="flex gap-4">
            {prev && (
              <Link to={href(prev.id)} replace className={step}>
                <ChevronLeft size={15} /> Game {i}
              </Link>
            )}
            {next && (
              <Link to={href(next.id)} replace className={step}>
                Game {i + 2} <ChevronRight size={15} />
              </Link>
            )}
          </span>
        </div>
        <MatchTable match={match} followSet={followSet} teamNames={teamNames} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {lobbies.length > 1 ? `${lobbies.length} lobbies · ` : ''}
          {plural(games, 'game')}
          {partial && ` · teams ranked 1 to ${(loaded * PAGE_SIZE).toLocaleString('en-US')} of the board`}
        </span>
        {partial && want < MAX_PAGES && (
          <Button
            size="sm"
            disabled={live.loading}
            onClick={() => {
              wantRef.current = MAX_PAGES;
              setWant(MAX_PAGES);
              live.refresh();
            }}
          >
            {live.loading
              ? 'Reading…'
              : `Read ${data.totalPages > MAX_PAGES ? `the top ${MAX_PAGES * PAGE_SIZE}` : 'every team'}`}
          </Button>
        )}
      </div>
      <MatchList lobbies={lobbies} tz={timeZone} matchHref={href} />
    </div>
  );
}
