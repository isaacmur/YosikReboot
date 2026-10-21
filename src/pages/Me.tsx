import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { windowState } from '../../lib/status';
import { EVENT_TYPES, type EventInfo, type EventType, type EventWindow } from '../../lib/types';
import { Card, LoadState, SectionTitle, SELECT } from '../components/ui';
import { formatDay, ordinal, REGION_LABEL, TYPE_LABEL } from '../format';
import { useFollows } from '../follows';
import { allScans, isWindowChecked, scanWindow, useScans, type BoardScan } from '../scan';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';

/** Rank over time on a log scale; lower is better, so the line rises as you improve. */
function Trend({ points }: { points: { at: string; rank: number }[] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 80;
  const logs = points.map((p) => Math.log10(p.rank));
  const [lo, hi] = [Math.min(...logs), Math.max(...logs)];
  const y = (rank: number) => (hi === lo ? h / 2 : 6 + ((Math.log10(rank) - lo) / (hi - lo)) * (h - 12));
  const x = (i: number) => 6 + (i / (points.length - 1)) * (w - 12);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' ');
  return (
    <Card className="p-3">
      <p className="text-xs text-zinc-500">Placement trend (best {ordinal(Math.min(...points.map((p) => p.rank)))})</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 w-full" role="img" aria-label="Placement trend">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-sky-600 dark:text-sky-400" />
        {points.map((p, i) => (
          <circle key={`${p.at}-${i}`} cx={x(i)} cy={y(p.rank)} r="3" className="fill-sky-600 dark:fill-sky-400" />
        ))}
      </svg>
    </Card>
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

export default function Me() {
  const follows = useFollows();
  const me = follows.find((f) => f.isMe);
  const [{ region, timeZone }] = useSettings();
  const { data, error, loading, reload } = useEvents();
  useScans(); // re-render when results are saved
  const [type, setType] = useState<EventType | ''>('');
  const [progress, setProgress] = useState<Progress>();
  const [stopped, setStopped] = useState<string>();
  const cancel = useRef<AbortController>(undefined);

  const ended: Session[] = useMemo(() => {
    const now = new Date();
    return (data?.events ?? [])
      .filter((e) => !type || e.type === type)
      .flatMap((event) => event.windows.filter((w) => windowState(w, now) === 'final').map((w) => ({ event, w })))
      .sort((a, b) => b.w.end.localeCompare(a.w.end));
  }, [data, type]);

  if (!me) {
    return (
      <Card className="p-4 text-sm">
        <p>Mark which follow is you to see your results here.</p>
        <Link to="/follows" className="mt-2 inline-block font-medium text-blue-600 underline dark:text-blue-400">
          Go to Follows
        </Link>
      </Card>
    );
  }

  /** Done = you were found, or a full pass over every scored board didn't find you. */
  const resultFor = (s: Session): { scan?: BoardScan; done: boolean } => {
    const hit = allScans().find((x) => x.eventId === s.event.id && x.windowId === s.w.id && x.found[me.id]);
    return { scan: hit, done: !!hit || isWindowChecked(s.event.id, s.w.id, me.id) };
  };

  const results = allScans()
    .filter((x) => x.found[me.id])
    .map((x) => ({ x, row: x.found[me.id]! }));

  async function check(list: Session[]) {
    cancel.current = new AbortController();
    setStopped(undefined);
    try {
      for (const [i, s] of list.entries()) {
        const label = `${s.event.name} · ${s.w.label}`;
        setProgress({ i: i + 1, n: list.length, label });
        await scanWindow(s.event.id, s.w.id, [me!.id], {
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

  const unchecked = ended.filter((s) => !resultFor(s).done);
  const progressText =
    progress &&
    `Checking ${progress.i} of ${progress.n}: ${progress.label}` +
      (progress.board && progress.board !== 'Overall' ? ` (${progress.board})` : '') +
      (progress.page ? ` · page ${progress.page} of ${progress.pages}` : '');

  return (
    <div>
      <h1 className="text-xl font-semibold">Me · {me.name}</h1>
      <SectionTitle>Your results this season</SectionTitle>
      {results.length ? (
        <>
          <Trend
            points={[...results].reverse().map(({ x, row }) => ({ at: x.endedAt ?? x.scannedAt, rank: row.rank }))}
          />
          <Card className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {results.map(({ x, row }) => (
              <Link
                key={`${x.eventId}|${x.windowId}|${x.board}`}
                to={`/events/${encodeURIComponent(x.eventId)}/${encodeURIComponent(x.windowId)}?board=${encodeURIComponent(x.board)}`}
                className="flex items-center justify-between gap-3 p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{x.title ?? x.windowId}</span>
                  <span className="text-xs text-zinc-500">
                    {x.endedAt ? formatDay(x.endedAt, timeZone) : ''}
                    {x.boardLabel !== 'Overall' ? ` · ${x.boardLabel}` : ''} · {row.matches} games · {row.victories} VR
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums">{ordinal(row.rank)}</span>
                  <span className="text-xs text-zinc-500 tabular-nums">{row.points.toLocaleString('en-US')} pts</span>
                </span>
              </Link>
            ))}
          </Card>
        </>
      ) : (
        <Card className="p-4 text-sm text-zinc-600 dark:text-zinc-400">No results found yet. Check events below.</Card>
      )}

      <SectionTitle>Check events in {REGION_LABEL[region]}</SectionTitle>
      <p className="text-xs text-zinc-500">
        Epic doesn't look up players directly, so checking reads the session's leaderboard page by page until it finds
        you. Finished sessions are checked once and remembered.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EventType | '')}
          className={SELECT}
          aria-label="Type"
        >
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {progress === undefined ? (
          <button
            onClick={() => void check(unchecked.slice(0, 5))}
            disabled={!unchecked.length}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Check the latest {Math.min(5, unchecked.length)} unchecked
          </button>
        ) : (
          <button
            onClick={() => cancel.current?.abort()}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
          >
            Stop
          </button>
        )}
      </div>
      {(progressText || stopped) && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{progressText || stopped}</p>
      )}
      {!data ? (
        <LoadState loading={loading} error={error} onRetry={reload} />
      ) : (
        <Card className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {ended.slice(0, 40).map((s) => {
            const r = resultFor(s);
            const row = r.scan?.found[me.id];
            return (
              <div key={s.w.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.event.name}</span>
                  <span className="text-xs text-zinc-500">
                    {s.w.label} · {formatDay(s.w.end, timeZone)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {row ? (
                    <span className="font-semibold tabular-nums">{ordinal(row.rank)}</span>
                  ) : r.done ? (
                    <span className="text-xs text-zinc-500">Not in top 10,000</span>
                  ) : (
                    <button
                      onClick={() => void check([s])}
                      disabled={progress !== undefined}
                      className="text-blue-600 underline disabled:opacity-50 dark:text-blue-400"
                    >
                      Check
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {!ended.length && <p className="p-4 text-sm text-zinc-500">No finished sessions match.</p>}
        </Card>
      )}
    </div>
  );
}
