import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { windowState } from '../../lib/status';
import type {
  BoardInfo,
  Entry,
  EventWindow,
  LeaderboardPage,
  PayoutTier,
  ScoringSummary,
  WindowDetail,
} from '../../lib/types';
import { apiGet, ApiError, useApi } from '../api';
import { Card, Countdown, LoadState, Pill, StateBadge, TAG } from '../components/ui';
import { formatRange, formatSecondsAgo, formatTime, ordinal, useNow } from '../format';
import { getFollows, useFollows } from '../follows';
import { useLiveQuery } from '../live';
import { scanBoard, type BoardScan } from '../scan';
import { useSettings } from '../settings';
import { dedupeTeams } from '../entries';
import { createStore } from '../store';
import { useEvent } from '../useEvent';

const tierPref = createStore<string>('yr.tier.v1', (r) => (typeof r === 'string' ? r : ''), '');

const teamName = (e: Entry) => e.members.map((m) => m.name ?? `${m.id.slice(0, 6)}…`).join(' & ');

function ScoringPanel({ board }: { board: BoardInfo }) {
  const s: ScoringSummary | null = board.scoring;
  const perElim = s?.elims.length && s.elims.every((r) => r.points === r.elims * s.elims[0]!.points);
  const payoutLabel = (p: PayoutTier) =>
    p.basis === 'rank'
      ? `Top ${p.threshold.toLocaleString('en-US')}`
      : p.basis === 'percentile'
        ? `Top ${+(p.threshold * 100).toFixed(2)}%`
        : `${p.threshold} pts`;
  if (!s && !board.payouts.length) return null;
  return (
    <details className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer font-medium">Scoring and payouts</summary>
      {s && (
        <div className="mt-2 space-y-2">
          <p>
            <span className="text-zinc-500">Placement: </span>
            {s.placement.map((p) => `${ordinal(p.place)} ${p.points}`).join(' · ')}
          </p>
          {s.elims.length > 0 && (
            <p>
              <span className="text-zinc-500">Eliminations: </span>
              {perElim
                ? `${s.elims[0]!.points} per elimination${s.elims.length < 100 ? `, up to ${s.elims.length}` : ''}`
                : s.elims.map((r) => `${r.elims}: ${r.points}`).join(' · ')}
            </p>
          )}
        </div>
      )}
      {board.payouts.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {board.payouts.map((p) => (
            <li key={`${p.basis}${p.threshold}`}>
              <span className="text-zinc-500">{payoutLabel(p)}: </span>
              {p.rewards.join(', ')}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Row({
  e,
  highlight,
  open,
  onToggle,
  tz,
}: {
  e: Entry;
  highlight: boolean;
  open: boolean;
  onToggle: () => void;
  tz: string;
}) {
  return (
    <li className={highlight ? 'bg-amber-50 dark:bg-amber-950/40' : ''}>
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left" aria-expanded={open}>
        <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{e.rank.toLocaleString('en-US')}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{teamName(e)}</span>
          <span className="block text-xs text-zinc-500">
            {e.matches} games · {e.victories} VR · {e.elims} elims{e.avgPlace !== null ? ` · avg ${e.avgPlace}` : ''}
          </span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{e.points.toLocaleString('en-US')}</span>
      </button>
      {open && e.sessions.length > 0 && (
        <table className="mx-3 mb-3 w-[calc(100%-1.5rem)] text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 text-left font-medium">Game</th>
              <th className="text-right font-medium">Place</th>
              <th className="text-right font-medium">Elims</th>
              <th className="text-right font-medium">Pts</th>
              <th className="text-right font-medium">Ended</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {e.sessions.map((s, i) => (
              <tr key={`${s.endedAt}-${i}`} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1">{i + 1}</td>
                <td className="text-right">{s.place ?? '—'}</td>
                <td className="text-right">{s.elims}</td>
                <td className="text-right">{s.points ?? '—'}</td>
                <td className="text-right">{s.endedAt ? formatTime(s.endedAt, tz) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

function Board({
  eventId,
  eventName,
  w,
  detail,
}: {
  eventId: string;
  eventName: string;
  w: EventWindow;
  detail: WindowDetail;
}) {
  const [{ timeZone, refreshSec }] = useSettings();
  const [params, setParams] = useSearchParams();
  const follows = useFollows();
  const now = useNow(1000);
  const state = windowState(w, now);
  const boards = detail.boards.filter((b) => b.hasPoints || b.computed || detail.boards.length === 1);
  const preferred = tierPref.get() && boards.find((b) => b.kind === 'tier' && b.label === tierPref.get());
  const boardId = params.get('board') ?? (preferred ? preferred.id : detail.defaultBoard);
  const board = detail.boards.find((b) => b.id === boardId) ?? detail.boards[0]!;
  const q = new URLSearchParams({ event: eventId, window: w.id, board: board.id });
  const live = useLiveQuery<LeaderboardPage>(`/api/leaderboard?${q}`, state, refreshSec * 1000);
  // Extra pages loaded on request, for the board they belong to.
  const [more, setMore] = useState<{ board: string; pages: LeaderboardPage[] }>({ board: '', pages: [] });
  const extra = more.board === board.id ? more.pages : [];
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string>();
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState<{
    running: boolean;
    done?: number;
    total?: number;
    result?: BoardScan;
    error?: string;
  }>({ running: false });

  const followIds = useMemo(() => new Set(follows.map((f) => f.id)), [follows]);
  // Ranks shift while a board is live or settling, so a team can turn up on two pages: keep its first row.
  const rows = dedupeTeams([...(live.data?.entries ?? []), ...extra.flatMap((p) => p.entries)]);
  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter((e) => e.members.some((m) => m.name?.toLowerCase().includes(needle))) : rows;
  const totalPages = live.data?.totalPages ?? 0;
  const loadedPages = 1 + extra.length;
  const followRows = rows.filter((e) => e.members.some((m) => followIds.has(m.id)));

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await apiGet<LeaderboardPage>(`/api/leaderboard?${q}&page=${loadedPages}`);
      setMore({ board: board.id, pages: [...extra, next] });
    } finally {
      setLoadingMore(false);
    }
  }

  async function findFollows() {
    const ids = getFollows().map((f) => f.id);
    if (!ids.length) return;
    setScan({ running: true });
    try {
      const result = await scanBoard(eventId, w.id, board.id, ids, {
        final: state === 'final',
        boardLabel: board.label,
        title: `${eventName} · ${w.label}`,
        endedAt: w.end,
        onProgress: (done, total) => setScan((s) => ({ ...s, done, total })),
      });
      setScan({ running: false, result });
    } catch (err) {
      setScan({ running: false, error: err instanceof ApiError || err instanceof Error ? err.message : 'Scan failed' });
    }
  }

  const pickBoard = (b: BoardInfo) => {
    if (b.kind === 'tier') tierPref.set(b.label);
    const next = new URLSearchParams(params);
    next.set('board', b.id);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <StateBadge state={state} />
        {live.receivedAt && <span>updated {formatSecondsAgo(live.receivedAt, now)}</span>}
        {live.nextAt && (
          <span>
            · next refresh <Countdown to={live.nextAt.toISOString()} now={now} />
          </span>
        )}
        {state === 'live' && (
          <span>
            · ends <Countdown to={w.end} now={now} />
          </span>
        )}
        <button onClick={live.refresh} className="ml-auto font-medium text-blue-600 underline dark:text-blue-400">
          Refresh
        </button>
      </div>
      {live.staleSince && (
        <p
          role="status"
          className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Stale since {formatTime(live.staleSince.toISOString(), timeZone)}: {live.error?.message}. Retrying
          automatically.
        </p>
      )}

      {boards.length > 1 && (
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Board">
          {boards.map((b) => (
            <button
              key={b.id}
              role="tab"
              aria-selected={b.id === board.id}
              onClick={() => pickBoard(b)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                b.id === board.id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-200 dark:bg-zinc-800'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {live.data?.approximate && (
        <p className="mt-2 text-xs text-zinc-500">
          Cumulative standings add up the top 300 of each session, so lower ranks are approximate.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a player on loaded pages"
          aria-label="Find a player"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      {follows.length > 0 && board.id !== 'cumulative' && (
        <Card className="mt-3 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Your follows</span>
            <button
              onClick={findFollows}
              disabled={scan.running}
              className="text-blue-600 underline disabled:opacity-50 dark:text-blue-400"
            >
              {scan.running ? `Searching… ${scan.done ?? 0}/${scan.total ?? '?'} pages` : 'Find on all pages'}
            </button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {follows.map((f) => {
              const onPage = followRows.find((e) => e.members.some((m) => m.id === f.id));
              const scanned = scan.result?.found[f.id];
              const rank = onPage?.rank ?? scanned?.rank;
              const points = onPage?.points ?? scanned?.points;
              return (
                <li key={f.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {f.name}
                    {f.isMe && <span className="text-zinc-500"> (you)</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-400">
                    {rank !== undefined
                      ? `${ordinal(rank)} · ${points?.toLocaleString('en-US')} pts`
                      : scan.result?.complete
                        ? 'not in top 10,000'
                        : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
          {scan.error && <p className="mt-1 text-rose-700 dark:text-rose-300">{scan.error}</p>}
        </Card>
      )}

      <Card className="mt-3">
        {!live.data ? (
          <LoadState loading={live.loading} error={live.error} onRetry={live.refresh} />
        ) : shown.length ? (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {shown.map((e) => (
              <Row
                key={e.teamKey}
                e={e}
                tz={timeZone}
                highlight={e.members.some((m) => followIds.has(m.id))}
                open={open === e.teamKey}
                onToggle={() => setOpen(open === e.teamKey ? undefined : e.teamKey)}
              />
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-zinc-500">
            {needle ? 'No one by that name on the loaded pages.' : 'No results yet.'}
          </p>
        )}
      </Card>
      {live.data && loadedPages < totalPages && board.id !== 'cumulative' && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 w-full rounded-lg border border-zinc-300 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {loadingMore
            ? 'Loading…'
            : `Load ranks ${(loadedPages * 100 + 1).toLocaleString('en-US')}–${((loadedPages + 1) * 100).toLocaleString('en-US')} (page ${loadedPages + 1} of ${totalPages})`}
        </button>
      )}
      <ScoringPanel board={board} />
    </div>
  );
}

export default function Leaderboard() {
  const params = useParams();
  const eventId = decodeURIComponent(params.eventId ?? '');
  const windowId = decodeURIComponent(params.windowId ?? '');
  const [{ timeZone }] = useSettings();
  const { event, loading, error, reload } = useEvent(eventId);
  const w = event?.windows.find((x) => x.id === windowId);
  const detail = useApi<WindowDetail>(
    w ? `/api/window?${new URLSearchParams({ event: eventId, window: windowId })}` : null,
    30 * 60_000,
  );

  if (!event || !w) {
    if (loading || error) return <LoadState loading={loading} error={error} onRetry={reload} />;
    return <Card className="p-4 text-sm">This session isn't in this season's schedule.</Card>;
  }
  return (
    <div>
      <Link
        to={`/events/${encodeURIComponent(eventId)}`}
        className="text-sm text-blue-600 underline dark:text-blue-400"
      >
        ← {event.name}
      </Link>
      <h1 className="mt-1 text-xl leading-tight font-semibold">{w.label}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{formatRange(w.begin, w.end, timeZone)}</p>
      {windowState(w) === 'upcoming' ? (
        <Card className="mt-4 p-4 text-sm">
          The leaderboard opens when the session starts. <Pill className={TAG}>Upcoming</Pill>
        </Card>
      ) : detail.data ? (
        <Board eventId={eventId} eventName={event.name} w={w} detail={detail.data} />
      ) : (
        <LoadState loading={detail.loading} error={detail.error} onRetry={detail.reload} />
      )}
    </div>
  );
}
