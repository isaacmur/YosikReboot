// A player's season (F23, F25): results from the boards you've searched (D10),
// best finish, prize money and qualifications from each board's payout tiers,
// placement over time, each result's points per game (F29), and a way to check
// more sessions. Me is this view for the follow marked as you.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { windowState } from '../../lib/status';
import {
  EVENT_TYPES,
  type EventArt,
  type EventInfo,
  type EventType,
  type EventWindow,
  type LeaderboardPage,
  type WindowDetail,
} from '../../lib/types';
import { apiGetCached, useApi } from '../api';
import { pageOfRank } from '../board';
import { fileName, saveFile, toCsv } from '../csv';
import { addFollow, removeFollow, useFollows } from '../follows';
import { formatDay, ordinal, plural, REGION_LABEL, TYPE_LABEL } from '../format';
import { eventPath } from '../links';
import { isSetLobby } from '../matches';
import { formatUsd, prizeFor, type Prize } from '../prizes';
import {
  allScans,
  didNotPlay,
  isWindowChecked,
  scanWindow,
  setScanPayouts,
  useScans,
  type BoardScan,
  type FoundRow,
} from '../scan';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';
import { LineChart, MatchChart } from './Charts';
import { ChevronDown, ChevronRight, DownloadIcon, StarIcon } from './icons';
import { GamesTable } from './MatchView';
import { SyncPanel } from './SyncPanel';
import { Art, Button, Chip, Empty, ErrorNote, LoadState, Panel, PillSelect, SectionHeader, Skeleton } from './ui';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <p className="text-[10px] font-semibold tracking-wider text-faint uppercase">{label}</p>
      <p className="mt-0.5 font-display text-2xl leading-none font-bold">{value}</p>
    </div>
  );
}

interface Result {
  x: BoardScan;
  row: FoundRow;
  prize?: Prize;
}

/**
 * Boards Epic shows past 100 pages don't say how many teams there are; percentile prizes need it.
 * Synced results (D30) didn't read the board, so they don't know either.
 */
const teamsOn = (x: BoardScan) =>
  x.totalPages > 0 && (x.complete || x.totalPages < 100) ? x.totalPages * 100 - 50 : undefined;

function resultsFor(id: string): Result[] {
  return allScans()
    .filter((x) => x.found[id])
    .map((x) => {
      const row = x.found[id]!;
      return { x, row, prize: x.payouts && prizeFor(row.rank, row.points, x.payouts, teamsOn(x)) };
    });
}

/** Gives older saved scans their payout tiers, a few windows per visit. */
function useBackfillPayouts(results: Result[]) {
  const missing = results
    .filter((r) => !r.x.payouts)
    .slice(0, 10)
    .map((r) => `${r.x.eventId}|${r.x.windowId}|${r.x.board}`)
    .join(',');
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    void (async () => {
      for (const key of missing.split(',')) {
        const [event, window, board] = key.split('|') as [string, string, string];
        try {
          const detail = await apiGetCached<WindowDetail>(
            `/api/window?${new URLSearchParams({ event, window })}`,
            3_600_000,
          );
          if (cancelled) return;
          setScanPayouts(event, window, board, detail.boards.find((b) => b.id === board)?.payouts ?? []);
        } catch {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missing]);
}

/** This player's row on the board, fetched on demand, with points per game. */
function ResultDetail({ id, x, row }: { id: string; x: BoardScan; row: FoundRow }) {
  const [{ timeZone }] = useSettings();
  const q = new URLSearchParams({
    event: x.eventId,
    window: x.windowId,
    board: x.board,
    page: String(pageOfRank(row.rank)),
  });
  const { data, error, loading, reload } = useApi<LeaderboardPage>(
    `/api/leaderboard?${q}`,
    x.final ? 3_600_000 : 60_000,
  );
  const entry = data?.entries.find((e) => e.members.some((m) => m.id === id));
  return (
    <div className="space-y-3 border-t border-line bg-bg/50 px-3 py-3">
      {!data ? (
        loading ? (
          <Skeleton className="h-36" />
        ) : (
          error && <ErrorNote error={error} onRetry={reload} />
        )
      ) : !entry ? (
        <p className="text-xs text-muted">Not on that page any more: standings moved since the search.</p>
      ) : (
        <>
          {entry.members.length > 1 && (
            <p className="text-xs text-muted">
              With{' '}
              {entry.members
                .filter((m) => m.id !== id)
                .map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ', '}
                    <Link to={`/players/${m.id}`} className="font-semibold text-ink hover:underline">
                      {m.name ?? `${m.id.slice(0, 6)}…`}
                    </Link>
                  </span>
                ))}
            </p>
          )}
          {entry.sessions.length > 0 && <MatchChart sessions={entry.sessions} tz={timeZone} />}
          <GamesTable
            sessions={entry.sessions}
            tz={timeZone}
            gameHref={
              isSetLobby(data.entries)
                ? (game) =>
                    eventPath(
                      x.eventId,
                      x.windowId,
                      new URLSearchParams({ board: x.board, tab: 'matches', match: game }).toString(),
                    )
                : undefined
            }
          />
        </>
      )}
      <Link
        to={eventPath(x.eventId, x.windowId, `board=${encodeURIComponent(x.board)}`)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-accent-bright hover:underline"
      >
        Open the board <ChevronRight size={13} />
      </Link>
    </div>
  );
}

function PrizeChips({ prize }: { prize?: Prize }) {
  if (!prize) return null;
  return (
    <>
      {prize.usd > 0 && <Chip tone="accent">{formatUsd(prize.usd)}</Chip>}
      {prize.qualifies.length > 0 && <Chip tone="accent">Qualified</Chip>}
      {prize.items.includes('Skin') && <Chip tone="accent">Skin</Chip>}
    </>
  );
}

interface Session {
  event: EventInfo;
  w: EventWindow;
}

interface Progress {
  i: number;
  n: number;
  label: string;
  board?: string;
  page?: number;
  pages?: number;
}

const NO_ART: EventArt = {};

export function PlayerView({ id, name, isMe }: { id: string; name: string; isMe?: boolean }) {
  const follows = useFollows();
  const following = follows.some((f) => f.id === id);
  const [{ region, timeZone }] = useSettings();
  const { data, error, loading, reload } = useEvents();
  useScans(); // re-render when results are saved
  const [type, setType] = useState<EventType | ''>('');
  const [progress, setProgress] = useState<Progress>();
  const [stopped, setStopped] = useState<string>();
  const [open, setOpen] = useState<string>();
  const cancel = useRef<AbortController>(undefined);

  const ended: Session[] = useMemo(() => {
    const now = new Date();
    return (data?.events ?? [])
      .filter((e) => !type || e.type === type)
      .flatMap((event) => event.windows.filter((w) => windowState(w, now) === 'final').map((w) => ({ event, w })))
      .sort((a, b) => b.w.end.localeCompare(a.w.end));
  }, [data, type]);
  const artFor = (eventId: string) => data?.events.find((e) => e.id === eventId)?.art ?? NO_ART;

  const results = resultsFor(id);
  useBackfillPayouts(results);
  const ranks = results.map((r) => r.row.rank);
  const prizeMoney = results.reduce((sum, r) => sum + (r.prize?.usd ?? 0), 0);
  const qualified = results.filter((r) => r.prize?.qualifies.length).length;

  /** Done = found, or a full pass over every scored board didn't find them. */
  const resultFor = (s: Session): { row?: FoundRow; done: boolean } => {
    const hit = allScans().find((x) => x.eventId === s.event.id && x.windowId === s.w.id && x.found[id]);
    return { row: hit?.found[id], done: !!hit || isWindowChecked(s.event.id, s.w.id, id) };
  };

  async function check(list: Session[]) {
    cancel.current = new AbortController();
    setStopped(undefined);
    try {
      for (const [i, s] of list.entries()) {
        const label = `${s.event.name} · ${s.w.label}`;
        setProgress({ i: i + 1, n: list.length, label });
        await scanWindow(s.event.id, s.w.id, [id], {
          final: true,
          title: label,
          endedAt: s.w.end,
          signal: cancel.current.signal,
          onBoard: (board) => setProgress({ i: i + 1, n: list.length, label, board }),
          onProgress: (page, pages) => setProgress((p) => (p ? { ...p, page, pages } : p)),
        });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setStopped(`Stopped: ${(err as Error).message}`);
    } finally {
      setProgress(undefined);
    }
  }

  const exportCsv = () =>
    saveFile(
      fileName([name, 'results']),
      toCsv([
        [
          'Event',
          'Ended',
          'Board',
          'Rank',
          'Points',
          'Games',
          'Wins',
          'Elims',
          'Avg place',
          'Prize (USD)',
          'Qualified for',
        ],
        ...results.map(({ x, row, prize }) => [
          x.title ?? x.windowId,
          x.endedAt ?? '',
          x.boardLabel,
          row.rank,
          row.points,
          row.matches,
          row.victories,
          row.elims,
          row.avgPlace,
          prize?.usd ?? null,
          prize?.qualifies.join('; '),
        ]),
      ]),
    );

  const unchecked = ended.filter((s) => !resultFor(s).done);
  // Sessions a sync showed weren't played stay out of the list (D30).
  const listed = ended.filter((s) => !didNotPlay(s.event.id, s.w.id, id));
  const skipped = ended.length - listed.length;
  const progressText =
    progress &&
    `Checking ${progress.i} of ${progress.n}: ${progress.label}` +
      (progress.board && progress.board !== 'Overall' ? ` (${progress.board})` : '') +
      (progress.page ? ` · page ${progress.page} of ${progress.pages}` : '');

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="skew grid size-12 shrink-0 place-items-center rounded-md bg-accent">
          <span className="font-display text-2xl font-bold text-accent-ink">{name.slice(0, 1).toUpperCase()}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 font-display text-3xl leading-none font-bold tracking-wide uppercase">
            <span className="truncate">{name}</span>
            {isMe && <Chip tone="accent">You</Chip>}
          </h1>
          <p className="mt-1 text-sm text-muted">
            This season, from sessions you've {isMe ? 'synced or checked' : 'checked'}
          </p>
        </div>
        <Button
          size="sm"
          variant={following ? 'secondary' : 'primary'}
          onClick={() => (following ? removeFollow(id) : addFollow(id, name))}
        >
          <StarIcon size={14} className={following ? 'fill-accent text-accent' : ''} />
          {following ? 'Following' : 'Follow'}
        </Button>
      </div>

      {isMe && (
        <div className="mb-4">
          <SyncPanel />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Best finish" value={ranks.length ? ordinal(Math.min(...ranks)) : '—'} />
        <Stat label="Results" value={String(results.length)} />
        <Stat label="Prize money" value={prizeMoney ? formatUsd(prizeMoney) : '—'} />
        <Stat label="Qualified" value={qualified ? plural(qualified, 'time') : '—'} />
      </div>

      <SectionHeader
        title="Results"
        action={
          results.length > 0 && (
            <Button size="sm" variant="ghost" onClick={exportCsv}>
              <DownloadIcon size={14} /> CSV
            </Button>
          )
        }
      />
      {results.length ? (
        <div className="space-y-3">
          {results.length > 1 && (
            <Panel className="p-4">
              <LineChart
                title="Placement over time · higher is better"
                ranks
                format={ordinal}
                points={[...results].reverse().map(({ x, row }) => ({
                  value: row.rank,
                  label: `${x.title ?? x.windowId}${x.endedAt ? ` · ${formatDay(x.endedAt, timeZone)}` : ''}`,
                }))}
              />
            </Panel>
          )}
          <Panel className="divide-y divide-line overflow-hidden">
            {results.map(({ x, row, prize }) => {
              const key = `${x.eventId}|${x.windowId}|${x.board}`;
              const isOpen = open === key;
              return (
                <div key={key}>
                  <button
                    onClick={() => setOpen(isOpen ? undefined : key)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-raised/60"
                  >
                    <Art
                      art={artFor(x.eventId)}
                      kind="square"
                      width={56}
                      className="size-11 shrink-0 rounded-md ring-1 ring-line"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{x.title ?? x.windowId}</span>
                      <span className="nums block truncate text-xs text-muted">
                        {x.endedAt ? formatDay(x.endedAt, timeZone) : ''}
                        {x.boardLabel !== 'Overall' ? ` · ${x.boardLabel}` : ''} · {plural(row.matches, 'game')} ·{' '}
                        {plural(row.victories, 'win')}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1 empty:hidden">
                        <PrizeChips prize={prize} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="nums block font-display text-xl leading-none font-bold">
                        {ordinal(row.rank)}
                      </span>
                      <span className="nums text-[11px] text-faint">{row.points.toLocaleString('en-US')} pts</span>
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-faint transition ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && <ResultDetail id={id} x={x} row={row} />}
                </div>
              );
            })}
          </Panel>
          {prizeMoney > 0 && (
            <p className="text-xs text-faint">
              Prize money is what Epic lists for each place; for duos and trios it doesn't say how it's split.
            </p>
          )}
        </div>
      ) : (
        <Empty>No results found yet. Check sessions below.</Empty>
      )}

      <SectionHeader title={`Check sessions · ${REGION_LABEL[region]}`} />
      <p className="max-w-prose text-xs text-muted">
        Epic doesn't look up players directly, so a check reads the session's leaderboard page by page until it finds{' '}
        {isMe ? 'you' : 'them'}. Finished sessions are checked once and remembered.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PillSelect value={type} onChange={(e) => setType(e.target.value as EventType | '')} aria-label="Type">
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </PillSelect>
        {progress === undefined ? (
          <Button variant="primary" onClick={() => void check(unchecked.slice(0, 5))} disabled={!unchecked.length}>
            Check the latest {Math.min(5, unchecked.length)}
          </Button>
        ) : (
          <Button onClick={() => cancel.current?.abort()}>Stop</Button>
        )}
      </div>
      {(progressText || stopped) && (
        <div className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted" role="status">
          {progressText || stopped}
          {progress?.pages ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${((progress.page ?? 0) / progress.pages) * 100}%` }}
              />
            </div>
          ) : null}
        </div>
      )}
      <div className="mt-3">
        {!data ? (
          <LoadState loading={loading} error={error} onRetry={reload} />
        ) : listed.length ? (
          <Panel className="divide-y divide-line overflow-hidden">
            {listed.slice(0, 40).map((s) => {
              const r = resultFor(s);
              return (
                <div key={s.w.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Art
                    art={s.event.art}
                    kind="square"
                    width={56}
                    className="size-10 shrink-0 rounded-md ring-1 ring-line"
                  />
                  <span className="min-w-0 flex-1">
                    <Link
                      to={eventPath(s.event.id, s.w.id)}
                      className="block truncate text-sm font-semibold hover:underline"
                    >
                      {s.event.name}
                    </Link>
                    <span className="block truncate text-xs text-muted">
                      {s.w.label} · {formatDay(s.w.end, timeZone)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {r.row ? (
                      <span className="nums font-display text-lg font-bold">{ordinal(r.row.rank)}</span>
                    ) : r.done ? (
                      <span className="text-xs text-faint">Not in top 10k</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void check([s])}
                        disabled={progress !== undefined}
                      >
                        Check
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </Panel>
        ) : (
          <Empty>{skipped ? 'You played every finished session that matches.' : 'No finished sessions match.'}</Empty>
        )}
        {skipped > 0 && (
          <p className="mt-2 text-xs text-faint">
            {plural(skipped, 'session')} you didn't play {skipped === 1 ? 'is' : 'are'} left out, from your last sync.
          </p>
        )}
      </div>
    </div>
  );
}
