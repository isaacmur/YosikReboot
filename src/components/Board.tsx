// The leaderboard for one session: board (tier) choice, live refresh of the
// pages in view, every page to the top 10,000 by scrolling or jumping to a rank
// (F14), movement arrows (F15), cutoff lines (F16), pinned follows and teams
// (F18, F24), the scoring table beside it (F21), and CSV export (F31).

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router';
import { windowState } from '../../lib/status';
import type { BoardInfo, Entry, EventWindow, LeaderboardPage, WindowDetail } from '../../lib/types';
import {
  boardRows,
  cutoffTitle,
  entryAtRank,
  linesAfter,
  PAGE_SIZE,
  pageOfRank,
  pageRuns,
  pinnedRows,
  placeCutoffs,
  watchedIds,
  type BoardRow,
  type PlacedCutoff,
} from '../board';
import { formatSecondsAgo, formatTime, plural, useNow } from '../format';
import { useFollows } from '../follows';
import { boardMoves, type Move } from '../movement';
import { lastScan, LIVE_TTL_MS, scanBoard, type BoardScan } from '../scan';
import { useSettings } from '../settings';
import { createStore } from '../store';
import { useTeams } from '../teams';
import { useBoard } from '../useBoard';
import { BoardExport } from './BoardExport';
import { fmtN, GapRow, HeaderRow, Row } from './BoardRows';
import { DownloadIcon, InfoIcon, RefreshIcon, SearchIcon } from './icons';
import { PinnedStrip, type SearchState } from './Pinned';
import { PrizesPanel, ScoringPanel } from './Scoring';
import { Button, Countdown, Empty, ErrorNote, ListSkeleton, Panel, SectionHeader, Segmented, Sheet } from './ui';

const tierPref = createStore<string>('yr.tier.v1', (r) => (typeof r === 'string' ? r : ''), '');

/** Boards worth showing (scored ones, or the only one) and the chosen one, kept in `?board=`. */
export function useBoardChoice(detail: WindowDetail | undefined) {
  const [params, setParams] = useSearchParams();
  const boards = detail ? detail.boards.filter((b) => b.hasPoints || b.computed || detail.boards.length === 1) : [];
  const preferred = tierPref.get() && boards.find((b) => b.kind === 'tier' && b.label === tierPref.get());
  const wanted = params.get('board') ?? (preferred ? preferred.id : detail?.defaultBoard);
  const board = detail ? (detail.boards.find((b) => b.id === wanted) ?? boards[0] ?? detail.boards[0]) : undefined;
  const pick = (b: BoardInfo) => {
    if (b.kind === 'tier') tierPref.set(b.label);
    const next = new URLSearchParams(params);
    next.set('board', b.id);
    setParams(next, { replace: true });
  };
  return { boards, board, pick };
}

export function BoardPicker({
  boards,
  board,
  onPick,
}: {
  boards: BoardInfo[];
  board: BoardInfo;
  onPick: (b: BoardInfo) => void;
}) {
  if (boards.length < 2) return null;
  return (
    <Segmented
      label="Board"
      items={boards.map((b) => ({ id: b.id, label: b.label }))}
      value={board.id}
      onChange={(id) => onPick(boards.find((b) => b.id === id)!)}
    />
  );
}

// --- The list ------------------------------------------------------------------------

interface Run {
  pages: number[];
  rows: BoardRow[];
  lines: Map<string, PlacedCutoff[]>;
}

/** Loaded pages as blocks of rows, with gaps between runs. Memoized: the page re-renders every second. */
const BoardList = memo(function BoardList({
  runs,
  moves,
  followSet,
  teamNames,
  open,
  flashTeam,
  onToggle,
  observe,
  pending,
  onLoad,
  tz,
}: {
  runs: Run[];
  moves: Map<string, Move>;
  followSet: Set<string>;
  teamNames: Map<string, string>;
  open?: string;
  flashTeam?: string;
  onToggle: (teamKey: string) => void;
  observe: (page: number) => (el: HTMLElement | null) => () => void;
  pending: number[];
  onLoad: (page: number) => void;
  tz: string;
}) {
  return (
    <Panel className="overflow-hidden">
      <HeaderRow />
      <div className="divide-y divide-line">
        {runs.map((run, i) => {
          const first = run.pages[0]!;
          const gapFrom = i > 0 ? runs[i - 1]!.pages[runs[i - 1]!.pages.length - 1]! + 1 : 0;
          return (
            <Fragment key={first}>
              {first > gapFrom && <GapRow fromPage={gapFrom} toPage={first - 1} pending={pending} onLoad={onLoad} />}
              {run.pages.map((p) => (
                <ul key={p} data-page={p} ref={observe(p)} className="page-block divide-y divide-line">
                  {run.rows
                    .filter((r) => r.page === p)
                    .map(({ entry: e }) => (
                      <Row
                        key={e.teamKey}
                        e={e}
                        tz={tz}
                        move={moves.get(e.teamKey)}
                        team={teamNames.get(e.teamKey)}
                        followed={e.members.some((m) => followSet.has(m.id))}
                        open={open === e.teamKey}
                        flash={flashTeam === e.teamKey}
                        lines={run.lines.get(e.teamKey)}
                        onToggle={onToggle}
                      />
                    ))}
                </ul>
              ))}
            </Fragment>
          );
        })}
      </div>
    </Panel>
  );
});

/** Loads the next page when it scrolls near, and on tap. */
function MoreRows({
  page,
  totalPages,
  loading,
  failed,
  onLoad,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  failed: boolean;
  onLoad: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || loading || failed) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && onLoad(page), {
      rootMargin: '0px 0px 800px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [page, loading, failed, onLoad]);
  return (
    <div ref={ref}>
      <Button className="w-full" onClick={() => onLoad(page)} disabled={loading}>
        {loading ? 'Loading…' : `Show ranks ${fmtN(page * PAGE_SIZE + 1)}–${fmtN((page + 1) * PAGE_SIZE)}`}
        <span className="font-normal text-faint">
          page {page + 1} of {totalPages}
        </span>
      </Button>
    </div>
  );
}

// --- Cutoffs -------------------------------------------------------------------------

/** The qualifying and paid lines, with the points each takes now (or took). Tap to see it on the board. */
function CutoffStrip({
  lines,
  pages,
  firstRun,
  teams,
  boardEnd,
  final,
  onJump,
}: {
  lines: PlacedCutoff[];
  pages: LeaderboardPage[];
  /** Rows from rank 1 down, for counting who reached a points line. */
  firstRun: Entry[];
  /** Teams on the board, once the last page is in. */
  teams?: number;
  boardEnd: boolean;
  final: boolean;
  onJump: (rank: number) => void;
}) {
  if (!lines.length) return null;
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" aria-label="Cutoffs">
      {lines.map((l) => {
        let value: string;
        let note: string;
        if (l.rank === null) {
          const below = firstRun.find((e) => e.points < l.threshold);
          const last = firstRun[firstRun.length - 1];
          value = below
            ? plural(below.rank - 1, 'team')
            : last
              ? `${fmtN(last.rank)}${boardEnd ? '' : '+'} team${last.rank === 1 ? '' : 's'}`
              : '…';
          note = final ? 'reached it' : 'reached it so far';
        } else if (teams !== undefined && l.rank > teams) {
          value = final ? 'Everyone' : 'Everyone so far';
          note = `${plural(teams, 'team')} on the board`;
        } else {
          const at = entryAtRank(l.rank, pages);
          value = at ? `${fmtN(at.points)} pts` : '…';
          note = final ? 'it took' : 'to make it now';
        }
        const tone = l.kind === 'cash' ? 'text-ok' : 'text-accent-bright';
        return (
          <button
            key={`${l.kind}|${l.basis}|${l.threshold}|${l.label}`}
            onClick={() => l.rank !== null && onJump(l.rank)}
            disabled={l.rank === null}
            title={l.label}
            className="w-40 shrink-0 rounded-lg border border-line bg-surface px-3 py-2 text-left transition hover:border-accent/60 disabled:pointer-events-none"
          >
            <span className={`nums block text-[10px] font-bold tracking-wider uppercase ${tone}`}>
              {l.approx && '≈ '}
              {cutoffTitle(l)} · {l.kind === 'cash' ? 'Paid' : 'Qualify'}
            </span>
            <span className="nums mt-0.5 block font-display text-xl leading-tight font-bold">{value}</span>
            <span className="block truncate text-[11px] text-faint">
              {note} · {l.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ToolButton({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-center gap-1 font-semibold text-accent-bright hover:underline"
    >
      {children}
    </button>
  );
}

// --- The board -----------------------------------------------------------------------

export function Leaderboard({
  eventId,
  eventName,
  w,
  board,
}: {
  eventId: string;
  eventName: string;
  w: EventWindow;
  board: BoardInfo;
}) {
  const [{ timeZone, refreshSec }] = useSettings();
  const follows = useFollows();
  const teams = useTeams();
  const now = useNow(1000);
  const state = windowState(w, now);
  const final = state === 'final';
  const followIds = useMemo(() => follows.map((f) => f.id), [follows]);
  const ids = useMemo(() => watchedIds(followIds, teams), [followIds, teams]);
  const watchRef = useRef<() => number[]>(() => []);
  const { pages, lite, totalPages, live, pending, loadError, loadPage, observe } = useBoard({
    eventId,
    windowId: w.id,
    board: board.id,
    state,
    liveMs: refreshSec * 1000,
    watch: () => watchRef.current(),
  });
  const boardKey = `${eventId}|${w.id}|${board.id}`;
  const query = new URLSearchParams({ event: eventId, window: w.id, board: board.id }).toString();

  // Rows, runs and movement.
  const rows = useMemo(() => boardRows(pages), [pages]);
  const entries = useMemo(() => rows.map((r) => r.entry), [rows]);
  const liteRows = useMemo(() => Object.values(lite).flatMap((p) => p.entries), [lite]);
  const moves = useMemo(
    () => (final ? new Map<string, Move>() : boardMoves(boardKey, pages, rows)),
    [final, boardKey, pages, rows],
  );
  const lastPage = pages[totalPages - 1] ?? lite[totalPages - 1];
  const teamsOnBoard = lastPage ? (totalPages - 1) * PAGE_SIZE + lastPage.entries.length : undefined;
  const placed = useMemo(
    () => placeCutoffs(board.cutoffs, totalPages, lastPage?.entries.length),
    [board.cutoffs, totalPages, lastPage],
  );
  const runs = useMemo(
    () =>
      pageRuns(Object.keys(pages).map(Number)).map((run): Run => {
        const runRows = rows.filter((r) => run.includes(r.page));
        return {
          pages: run,
          rows: runRows,
          lines: linesAfter(
            runRows.map((r) => r.entry),
            placed,
          ),
        };
      }),
    [pages, rows, placed],
  );
  const lastLoaded = runs.length ? runs[runs.length - 1]!.pages[runs[runs.length - 1]!.pages.length - 1]! : -1;

  // Cutoff summary: qualifying and paid lines; read their pages (lite) when not loaded.
  const summary = placed.filter((c) => c.kind !== 'item');
  const summaryPages = [
    ...new Set(
      summary.flatMap((c) => (c.rank !== null && c.rank <= totalPages * PAGE_SIZE ? [pageOfRank(c.rank)] : [])),
    ),
  ];
  const followPages = [
    ...new Set(rows.filter((r) => r.entry.members.some((m) => ids.includes(m.id))).map((r) => r.page)),
  ];
  watchRef.current = () => [...followPages, ...summaryPages];
  const needLite = summaryPages.filter((p) => !pages[p] && !lite[p]).join(',');
  useEffect(() => {
    if (needLite) for (const p of needLite.split(',')) void loadPage(Number(p), true);
  }, [needLite, loadPage]);

  // Pinned follows and teams.
  const [search, setSearch] = useState<SearchState>({ running: false });
  const [scan, setScan] = useState<BoardScan | undefined>(() => lastScan(eventId, w.id, board.id));
  const canSearch = board.id !== 'cumulative';
  const allRows = useMemo(() => [...entries, ...liteRows], [entries, liteRows]);
  const { pinned, missing } = useMemo(() => pinnedRows(allRows, scan?.found, ids), [allRows, scan, ids]);
  const searchComplete = !!scan?.complete && missing.every((id) => scan.searchedFor.includes(id));
  const followNames = useMemo(() => new Map(follows.map((f) => [f.id, f.name])), [follows]);

  async function find(quiet: boolean) {
    // Final boards: everyone, so the saved result answers for all your follows (Me, Home).
    // Live boards: only who isn't on a loaded page, starting where they were last found.
    const onLoaded = new Set(allRows.flatMap((r) => r.members.map((m) => m.id)));
    const want = final ? ids : ids.filter((id) => !onLoaded.has(id));
    if (!want.length) return;
    const hints = [...new Set(want.flatMap((id) => (scan?.found[id] ? [pageOfRank(scan.found[id].rank)] : [])))];
    setSearch({ running: true, quiet });
    try {
      const result = await scanBoard(eventId, w.id, board.id, want, {
        final,
        boardLabel: board.label,
        title: `${eventName} · ${w.label}`,
        endedAt: w.end,
        payouts: board.payouts,
        hints,
        onProgress: (done, total) => setSearch((s) => ({ ...s, done, total })),
      });
      setScan(result);
      setSearch({ running: false });
    } catch (err) {
      setSearch({ running: false, error: quiet ? undefined : (err as Error).message || 'Search failed' });
    }
  }
  const findRef = useRef(find);
  findRef.current = find;
  const watchState = useRef({ scan, running: search.running });
  watchState.current = { scan, running: search.running };
  // A live board repeats your last search every few minutes, for follows off the loaded pages (D10).
  // Attempts are spaced out too, so a failing search (Epic rate limiting) doesn't retry every tick.
  const polling = state === 'live' || state === 'wrapping';
  const lastTry = useRef(0);
  useEffect(() => {
    if (!polling || !canSearch) return;
    const id = setInterval(() => {
      const { scan: last, running } = watchState.current;
      if (!last || running || document.hidden) return;
      if (Date.now() - Date.parse(last.scannedAt) < LIVE_TTL_MS || Date.now() - lastTry.current < LIVE_TTL_MS) return;
      lastTry.current = Date.now();
      void findRef.current(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [polling, canSearch]);

  // Expanding rows, searching names, jumping to a rank.
  const [open, setOpen] = useState<string>();
  const onToggle = useCallback((k: string) => setOpen((o) => (o === k ? undefined : k)), []);
  const [filter, setFilter] = useState('');
  const [jump, setJump] = useState('');
  const [flash, setFlash] = useState<{ rank: number; teamKey?: string; n: number }>();
  const needle = filter.trim().toLowerCase();
  const filtered = needle ? entries.filter((e) => e.members.some((m) => m.name?.toLowerCase().includes(needle))) : [];
  const maxRank = Math.max(1, totalPages) * PAGE_SIZE;

  const jumpTo = useCallback(
    async (rank: number, teamKey?: string) => {
      const r = Math.min(Math.max(1, Math.round(rank)), maxRank);
      setFilter('');
      if (!pages[pageOfRank(r)]) await loadPage(pageOfRank(r));
      setFlash((f) => ({ rank: r, teamKey, n: (f?.n ?? 0) + 1 }));
    },
    [maxRank, pages, loadPage],
  );
  const flashTeam = flash
    ? flash.teamKey && entries.some((e) => e.teamKey === flash.teamKey)
      ? flash.teamKey
      : entries.find((e) => e.rank === flash.rank)?.teamKey
    : undefined;
  useEffect(() => {
    if (!flash) return;
    const el =
      (flash.teamKey && document.querySelector(`[data-team="${CSS.escape(flash.teamKey)}"]`)) ||
      document.querySelector(`[data-rank="${flash.rank}"]`);
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    const t = setTimeout(() => setFlash(undefined), 2400);
    return () => clearTimeout(t);
  }, [flash]);
  const onJump = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(jump.replace(/[^\d]/g, ''));
    if (n > 0) void jumpTo(n);
  };

  const [sheet, setSheet] = useState<'scoring' | 'export'>();
  const followSet = useMemo(() => new Set(followIds), [followIds]);
  const teamNames = useMemo(() => new Map(teams.map((t) => [t.key, t.name])), [teams]);
  const loaded = !!pages[0];

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-5">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {live.receivedAt && <span>Updated {formatSecondsAgo(live.receivedAt, now)}</span>}
          {live.nextAt && (
            <span>
              Next refresh <Countdown to={live.nextAt.toISOString()} now={now} />
            </span>
          )}
          {final && loaded && <span>Final standings</span>}
          {state === 'wrapping' && <span>Results can still change while Epic settles them</span>}
          <span className="ml-auto flex items-center gap-3">
            <span className="lg:hidden">
              <ToolButton onClick={() => setSheet('scoring')}>
                <InfoIcon size={13} /> Scoring
              </ToolButton>
            </span>
            <ToolButton onClick={() => setSheet('export')}>
              <DownloadIcon size={13} /> Export
            </ToolButton>
            <ToolButton onClick={live.refresh} label="Refresh leaderboard">
              <RefreshIcon size={13} className={live.loading ? 'animate-spin' : ''} /> Refresh
            </ToolButton>
          </span>
        </div>

        {live.staleSince && (
          <p role="status" className="rounded-md border border-wrap/40 bg-wrap/10 px-3 py-2 text-xs">
            Showing data from {formatTime(live.staleSince.toISOString(), timeZone)}: {live.error?.message}. Retrying on
            its own.
          </p>
        )}
        {pages[0]?.approximate && (
          <p className="text-xs text-faint">
            Cumulative standings add up the top 300 of each session, so lower ranks are approximate.
          </p>
        )}

        {entries.length > 0 && (
          <CutoffStrip
            lines={summary}
            pages={[...Object.values(pages), ...Object.values(lite)]}
            firstRun={runs[0]?.rows.map((r) => r.entry) ?? []}
            teams={teamsOnBoard}
            boardEnd={lastLoaded >= totalPages - 1}
            final={final}
            onJump={(r) => void jumpTo(r)}
          />
        )}

        {ids.length > 0 && entries.length > 0 && (
          <PinnedStrip
            pinned={pinned}
            missing={missing}
            rows={entries}
            names={followNames}
            teams={teams}
            moves={moves}
            search={search}
            searchedAt={scan?.scannedAt}
            searchComplete={searchComplete}
            canSearch={canSearch}
            totalPages={totalPages}
            final={final}
            tz={timeZone}
            onFind={() => void find(false)}
            onJump={(r, k) => void jumpTo(r, k)}
          />
        )}

        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Search ${fmtN(entries.length)} loaded`}
              aria-label="Search loaded players"
              className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
          </label>
          <form onSubmit={onJump} className="flex shrink-0 gap-1.5">
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              inputMode="numeric"
              pattern="[0-9,]*"
              placeholder="Rank"
              aria-label={`Jump to rank (1 to ${fmtN(maxRank)})`}
              className="nums h-9 w-20 rounded-md border border-line bg-surface px-3 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
            <Button type="submit" disabled={!jump.trim() || !loaded}>
              Go
            </Button>
          </form>
        </div>

        {!loaded ? (
          live.error ? (
            <ErrorNote error={live.error} onRetry={live.refresh} />
          ) : (
            <ListSkeleton rows={8} />
          )
        ) : !entries.length ? (
          <Empty>No results yet. Check back once games finish.</Empty>
        ) : needle ? (
          filtered.length ? (
            <Panel className="overflow-hidden">
              <HeaderRow />
              <ul className="divide-y divide-line">
                {filtered.map((e) => (
                  <Row
                    key={e.teamKey}
                    e={e}
                    tz={timeZone}
                    move={moves.get(e.teamKey)}
                    team={teamNames.get(e.teamKey)}
                    followed={e.members.some((m) => followSet.has(m.id))}
                    open={open === e.teamKey}
                    flash={false}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            </Panel>
          ) : (
            <Empty>No one by that name on the loaded pages.</Empty>
          )
        ) : (
          <BoardList
            runs={runs}
            moves={moves}
            followSet={followSet}
            teamNames={teamNames}
            open={open}
            flashTeam={flashTeam}
            onToggle={onToggle}
            observe={observe}
            pending={pending}
            onLoad={loadPage}
            tz={timeZone}
          />
        )}

        {loaded && !needle && entries.length > 0 && lastLoaded + 1 < totalPages && (
          <MoreRows
            key={lastLoaded + 1}
            page={lastLoaded + 1}
            totalPages={totalPages}
            loading={pending.includes(lastLoaded + 1)}
            failed={!!loadError}
            onLoad={loadPage}
          />
        )}
        {loaded && !needle && entries.length > 0 && lastLoaded + 1 >= totalPages && board.id !== 'cumulative' && (
          <p className="text-center text-xs text-faint">
            {totalPages >= 100
              ? "That's the top 10,000, as far as Epic lists."
              : `End of the board: ${plural(teamsOnBoard ?? entries.length, 'team')}.`}
          </p>
        )}
        {loadError && <ErrorNote error={loadError} onRetry={() => void loadPage(lastLoaded + 1)} />}
      </div>

      <aside
        className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain lg:block"
        aria-label="Scoring and prizes"
      >
        <SectionHeader title="Scoring" />
        <ScoringPanel board={board} />
        <SectionHeader title="Prizes" />
        <PrizesPanel board={board} />
      </aside>

      <Sheet open={sheet === 'scoring'} onClose={() => setSheet(undefined)} title={`Scoring · ${board.label}`}>
        <ScoringPanel board={board} />
        <SectionHeader title="Prizes" />
        <PrizesPanel board={board} />
      </Sheet>
      <Sheet open={sheet === 'export'} onClose={() => setSheet(undefined)} title="Export CSV">
        <BoardExport
          rows={entries}
          pages={pages}
          query={query}
          totalPages={totalPages}
          final={final}
          name={[eventName, w.label, board.kind === 'main' ? '' : board.label]}
          teamName={(k) => teamNames.get(k)}
        />
      </Sheet>
    </div>
  );
}
