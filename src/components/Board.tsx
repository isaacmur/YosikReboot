// The leaderboard for one session: board (tier) choice, live refresh, compact
// rows with a per-game breakdown, follows, search and paging; plus the scoring
// and prize panels the Rules tab shows for the same board.

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { windowState } from '../../lib/status';
import type { BoardInfo, Entry, EventWindow, LeaderboardPage, PayoutTier, WindowDetail } from '../../lib/types';
import { apiGet, ApiError } from '../api';
import { dedupeTeams } from '../entries';
import { formatSecondsAgo, formatTime, ordinal, plural, useNow } from '../format';
import { getFollows, useFollows } from '../follows';
import { useLiveQuery } from '../live';
import { scanBoard, type BoardScan } from '../scan';
import { useSettings } from '../settings';
import { createStore } from '../store';
import { RefreshIcon, SearchIcon, StarIcon } from './icons';
import { Button, Chip, Countdown, Empty, ListSkeleton, Panel, Segmented, ErrorNote } from './ui';

const tierPref = createStore<string>('yr.tier.v1', (r) => (typeof r === 'string' ? r : ''), '');

const fmtN = (n: number) => n.toLocaleString('en-US');

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

// --- Rows ----------------------------------------------------------------------

const RANK_TONE: Record<number, string> = { 1: 'text-gold', 2: 'text-silver', 3: 'text-bronze' };
const COLS =
  'grid grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:grid-cols-[3.25rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem_3.75rem_4.5rem]';

function Names({ e }: { e: Entry }) {
  return (
    <span className="block truncate font-semibold">
      {e.members.map((m, i) => (
        <span key={m.id}>
          {i > 0 && <span className="px-1 font-normal text-faint">/</span>}
          {m.name ?? `${m.id.slice(0, 6)}…`}
        </span>
      ))}
    </span>
  );
}

function Games({ e, tz }: { e: Entry; tz: string }) {
  return (
    <div className="border-t border-line bg-bg/60 px-3 py-2.5 sm:pl-[3.25rem]">
      <table className="nums w-full max-w-md text-xs">
        <thead className="text-faint">
          <tr className="text-[10px] tracking-wider uppercase">
            <th className="pb-1 text-left font-semibold">Game</th>
            <th className="pb-1 text-right font-semibold">Place</th>
            <th className="pb-1 text-right font-semibold">Elims</th>
            <th className="pb-1 text-right font-semibold">Pts</th>
            <th className="pb-1 text-right font-semibold">Ended</th>
          </tr>
        </thead>
        <tbody>
          {e.sessions.map((s, i) => (
            <tr key={`${s.endedAt}-${i}`} className="border-t border-line/70">
              <td className="py-1 text-muted">{i + 1}</td>
              <td className={`py-1 text-right ${s.victory ? 'font-bold text-accent-bright' : ''}`}>
                {s.place ? (s.victory ? 'Win' : `#${s.place}`) : '—'}
              </td>
              <td className="py-1 text-right">{s.elims}</td>
              <td className="py-1 text-right font-semibold">{s.points ?? '—'}</td>
              <td className="py-1 text-right text-muted">{s.endedAt ? formatTime(s.endedAt, tz) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  e,
  followed,
  open,
  onToggle,
  tz,
}: {
  e: Entry;
  followed: boolean;
  open: boolean;
  onToggle: () => void;
  tz: string;
}) {
  return (
    <li className={`relative ${followed ? 'bg-accent-soft' : ''}`}>
      {followed && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden />}
      <button
        onClick={onToggle}
        aria-expanded={open}
        disabled={!e.sessions.length}
        className={`${COLS} min-h-11 w-full items-center gap-x-2 px-3 py-1.5 text-left text-sm transition hover:bg-raised/60 disabled:cursor-default`}
      >
        <span className={`nums font-display text-lg leading-none font-bold ${RANK_TONE[e.rank] ?? 'text-muted'}`}>
          {fmtN(e.rank)}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            {followed && <StarIcon size={13} className="shrink-0 fill-accent text-accent" />}
            <Names e={e} />
          </span>
          <span className="nums block text-[11px] text-faint sm:hidden">
            {plural(e.matches, 'game')} · {plural(e.victories, 'win')} · {plural(e.elims, 'elim')}
          </span>
        </span>
        <span className="nums hidden text-right text-muted sm:block">{e.matches}</span>
        <span className="nums hidden text-right text-muted sm:block">{e.victories}</span>
        <span className="nums hidden text-right text-muted sm:block">{e.elims}</span>
        <span className="nums hidden text-right text-muted sm:block">{e.avgPlace ?? '—'}</span>
        <span className="nums text-right font-bold">{fmtN(e.points)}</span>
      </button>
      {open && e.sessions.length > 0 && <Games e={e} tz={tz} />}
    </li>
  );
}

function HeaderRow() {
  return (
    <div
      className={`${COLS} gap-x-2 border-b border-line px-3 py-2 text-[10px] font-semibold tracking-wider text-faint uppercase`}
    >
      <span>#</span>
      <span>Player</span>
      <span className="hidden text-right sm:block">Games</span>
      <span className="hidden text-right sm:block">Wins</span>
      <span className="hidden text-right sm:block">Elims</span>
      <span className="hidden text-right sm:block">Avg</span>
      <span className="text-right">Points</span>
    </div>
  );
}

// --- Follows ---------------------------------------------------------------------

interface ScanState {
  running: boolean;
  done?: number;
  total?: number;
  result?: BoardScan;
  error?: string;
}

function FollowStrip({
  rows,
  scan,
  onFind,
  board,
}: {
  rows: Entry[];
  scan: ScanState;
  onFind: () => void;
  board: BoardInfo;
}) {
  const follows = useFollows();
  if (!follows.length) return null;
  const canScan = board.id !== 'cumulative';
  return (
    <Panel className="p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm font-bold tracking-wider text-muted uppercase">Your follows</h3>
        {canScan && (
          <Button size="sm" variant="ghost" onClick={onFind} disabled={scan.running}>
            <SearchIcon size={14} />
            {scan.running ? `Searching ${scan.done ?? 0}/${scan.total ?? '…'}` : 'Find on all pages'}
          </Button>
        )}
      </div>
      {scan.running && scan.total ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${((scan.done ?? 0) / scan.total) * 100}%` }}
          />
        </div>
      ) : null}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {follows.map((f) => {
          const onPage = rows.find((e) => e.members.some((m) => m.id === f.id));
          const scanned = scan.result?.found[f.id];
          const rank = onPage?.rank ?? scanned?.rank;
          const points = onPage?.points ?? scanned?.points;
          return (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-md border border-line bg-raised px-2 py-1 text-xs"
            >
              <span className="max-w-[9rem] truncate font-semibold">{f.name}</span>
              {f.isMe && <Chip tone="accent">You</Chip>}
              <span className="nums text-muted">
                {rank !== undefined ? (
                  <>
                    <span className="font-bold text-ink">{ordinal(rank)}</span> · {fmtN(points ?? 0)}
                  </>
                ) : scan.result?.complete ? (
                  'not in top 10k'
                ) : (
                  '—'
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {scan.error && <p className="mt-2 text-xs text-live">{scan.error}</p>}
    </Panel>
  );
}

// --- The board -------------------------------------------------------------------

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
  const now = useNow(1000);
  const state = windowState(w, now);
  const q = new URLSearchParams({ event: eventId, window: w.id, board: board.id });
  const live = useLiveQuery<LeaderboardPage>(`/api/leaderboard?${q}`, state, refreshSec * 1000);
  // Extra pages loaded on request, for the board they belong to.
  const [more, setMore] = useState<{ key: string; pages: LeaderboardPage[] }>({ key: '', pages: [] });
  const extra = more.key === q.toString() ? more.pages : [];
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<Error>();
  const [open, setOpen] = useState<string>();
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState<ScanState & { key?: string }>({ running: false });
  const scanHere = scan.key === q.toString() ? scan : { running: false };

  const followIds = useMemo(() => new Set(follows.map((f) => f.id)), [follows]);
  const rows = dedupeTeams([...(live.data?.entries ?? []), ...extra.flatMap((p) => p.entries)]);
  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter((e) => e.members.some((m) => m.name?.toLowerCase().includes(needle))) : rows;
  const totalPages = live.data?.totalPages ?? 0;
  const loadedPages = 1 + extra.length;

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(undefined);
    const key = q.toString();
    try {
      const next = await apiGet<LeaderboardPage>(`/api/leaderboard?${q}&page=${loadedPages}`);
      setMore({ key, pages: [...extra, next] });
    } catch (err) {
      setMoreError(err as Error);
    } finally {
      setLoadingMore(false);
    }
  }

  async function findFollows() {
    const ids = getFollows().map((f) => f.id);
    if (!ids.length) return;
    const key = q.toString();
    setScan({ running: true, key });
    try {
      const result = await scanBoard(eventId, w.id, board.id, ids, {
        final: state === 'final',
        boardLabel: board.label,
        title: `${eventName} · ${w.label}`,
        endedAt: w.end,
        onProgress: (done, total) => setScan((s) => ({ ...s, done, total })),
      });
      setScan({ running: false, result, key });
    } catch (err) {
      setScan({
        running: false,
        key,
        error: err instanceof ApiError || err instanceof Error ? err.message : 'Search failed',
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {live.receivedAt && <span>Updated {formatSecondsAgo(live.receivedAt, now)}</span>}
        {live.nextAt && (
          <span>
            Next refresh <Countdown to={live.nextAt.toISOString()} now={now} />
          </span>
        )}
        {state === 'final' && live.data && <span>Final standings</span>}
        {state === 'wrapping' && <span>Results can still change while Epic settles them</span>}
        <button
          onClick={live.refresh}
          className="ml-auto inline-flex items-center gap-1 font-semibold text-accent-bright hover:underline"
          aria-label="Refresh leaderboard"
        >
          <RefreshIcon size={13} className={live.loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {live.staleSince && (
        <p role="status" className="rounded-md border border-wrap/40 bg-wrap/10 px-3 py-2 text-xs">
          Showing data from {formatTime(live.staleSince.toISOString(), timeZone)}: {live.error?.message}. Retrying on
          its own.
        </p>
      )}
      {live.data?.approximate && (
        <p className="text-xs text-faint">
          Cumulative standings add up the top 300 of each session, so lower ranks are approximate.
        </p>
      )}

      <FollowStrip rows={rows} scan={scanHere} onFind={() => void findFollows()} board={board} />

      <label className="relative block">
        <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${fmtN(rows.length)} loaded players`}
          aria-label="Search loaded players"
          className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent"
        />
      </label>

      {!live.data ? (
        live.error ? (
          <ErrorNote error={live.error} onRetry={live.refresh} />
        ) : (
          <ListSkeleton rows={8} />
        )
      ) : shown.length ? (
        <Panel className="overflow-hidden">
          <HeaderRow />
          <ul className="divide-y divide-line">
            {shown.map((e) => (
              <Row
                key={e.teamKey}
                e={e}
                tz={timeZone}
                followed={e.members.some((m) => followIds.has(m.id))}
                open={open === e.teamKey}
                onToggle={() => setOpen(open === e.teamKey ? undefined : e.teamKey)}
              />
            ))}
          </ul>
        </Panel>
      ) : (
        <Empty>
          {needle ? 'No one by that name on the loaded pages.' : 'No results yet. Check back once games finish.'}
        </Empty>
      )}

      {live.data && loadedPages < totalPages && board.id !== 'cumulative' && (
        <Button className="w-full" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : `Show ranks ${fmtN(loadedPages * 100 + 1)}–${fmtN((loadedPages + 1) * 100)}`}
          <span className="font-normal text-faint">
            page {loadedPages + 1} of {totalPages}
          </span>
        </Button>
      )}
      {moreError && <ErrorNote error={moreError} onRetry={() => void loadMore()} />}
    </div>
  );
}

// --- Scoring and prizes (Rules tab) ------------------------------------------------

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
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-line">
        {board.payouts.map((p) => (
          <li key={`${p.basis}${p.threshold}`} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className="nums w-28 shrink-0 font-display text-base font-bold tracking-wide uppercase">
              {payoutLabel(p)}
            </span>
            <span className="min-w-0 flex-1 text-muted">{p.rewards.join(', ')}</span>
            {p.qualifies && <Chip tone="accent">Qualifies</Chip>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
