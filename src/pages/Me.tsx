import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { windowState } from '../../lib/status';
import { EVENT_TYPES, type EventArt, type EventInfo, type EventType, type EventWindow } from '../../lib/types';
import { ChevronRight, DownloadIcon } from '../components/icons';
import { Art, Button, Empty, LoadState, Panel, PillSelect, SectionHeader } from '../components/ui';
import { fileName, saveFile, toCsv } from '../csv';
import { formatDay, ordinal, plural, REGION_LABEL, TYPE_LABEL } from '../format';
import { useFollows } from '../follows';
import { eventPath } from '../links';
import { allScans, isWindowChecked, scanWindow, useScans, type BoardScan } from '../scan';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';

/** Rank over time on a log scale; lower is better, so the line rises as you improve. */
function Trend({ points }: { points: { at: string; rank: number }[] }) {
  if (points.length < 2) return null;
  const w = 640;
  const h = 120;
  const logs = points.map((p) => Math.log10(p.rank));
  const [lo, hi] = [Math.min(...logs), Math.max(...logs)];
  const y = (rank: number) => (hi === lo ? h / 2 : 10 + ((Math.log10(rank) - lo) / (hi - lo)) * (h - 20));
  const x = (i: number) => 10 + (i / (points.length - 1)) * (w - 20);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`;
  return (
    <Panel className="p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-bold tracking-wider text-muted uppercase">Placement trend</h3>
        <span className="text-xs text-faint">higher is better</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full overflow-visible" role="img" aria-label="Placement trend">
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-fill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle
            key={`${p.at}-${i}`}
            cx={x(i)}
            cy={y(p.rank)}
            r="4"
            fill="var(--bg)"
            stroke="var(--accent-bright)"
            strokeWidth="2"
          />
        ))}
      </svg>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <p className="text-[10px] font-semibold tracking-wider text-faint uppercase">{label}</p>
      <p className="nums mt-0.5 font-display text-2xl leading-none font-bold">{value}</p>
    </div>
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
  const artFor = (eventId: string) => data?.events.find((e) => e.id === eventId)?.art ?? NO_ART;

  if (!me) {
    return (
      <div className="py-10">
        <Empty
          action={
            <Link to="/follows" className="font-semibold text-accent-bright hover:underline">
              Go to Follows
            </Link>
          }
        >
          Follow yourself and mark the follow as you to see your results here.
        </Empty>
      </div>
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
  const ranks = results.map((r) => r.row.rank);

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
      <div className="mb-5 flex items-center gap-3">
        <span className="skew grid size-12 shrink-0 place-items-center rounded-md bg-accent">
          <span className="font-display text-2xl font-bold text-accent-ink">{me.name.slice(0, 1).toUpperCase()}</span>
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl leading-none font-bold tracking-wide uppercase">{me.name}</h1>
          <p className="mt-1 text-sm text-muted">Your season, from sessions you've checked</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Best finish" value={ranks.length ? ordinal(Math.min(...ranks)) : '—'} />
        <Stat label="Results" value={String(results.length)} />
        <Stat label="Latest" value={results[0] ? ordinal(results[0].row.rank) : '—'} />
      </div>

      <SectionHeader
        title="Your results"
        action={
          results.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                saveFile(
                  fileName([me.name, 'results']),
                  toCsv([
                    ['Event', 'Ended', 'Board', 'Rank', 'Points', 'Games', 'Wins', 'Elims', 'Avg place'],
                    ...results.map(({ x, row }) => [
                      x.title ?? x.windowId,
                      x.endedAt ?? '',
                      x.boardLabel,
                      row.rank,
                      row.points,
                      row.matches,
                      row.victories,
                      row.elims,
                      row.avgPlace,
                    ]),
                  ]),
                )
              }
            >
              <DownloadIcon size={14} /> CSV
            </Button>
          )
        }
      />
      {results.length ? (
        <div className="space-y-3">
          <Trend
            points={[...results].reverse().map(({ x, row }) => ({ at: x.endedAt ?? x.scannedAt, rank: row.rank }))}
          />
          <Panel className="divide-y divide-line overflow-hidden">
            {results.map(({ x, row }) => (
              <Link
                key={`${x.eventId}|${x.windowId}|${x.board}`}
                to={eventPath(x.eventId, x.windowId, `board=${encodeURIComponent(x.board)}`)}
                className="group flex items-center gap-3 px-3 py-2.5 transition hover:bg-raised/60"
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
                </span>
                <span className="shrink-0 text-right">
                  <span className="nums block font-display text-xl leading-none font-bold">{ordinal(row.rank)}</span>
                  <span className="nums text-[11px] text-faint">{row.points.toLocaleString('en-US')} pts</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-faint" />
              </Link>
            ))}
          </Panel>
        </div>
      ) : (
        <Empty>No results found yet. Check sessions below.</Empty>
      )}

      <SectionHeader title={`Check sessions · ${REGION_LABEL[region]}`} />
      <p className="max-w-prose text-xs text-muted">
        Epic doesn't look up players directly, so a check reads the session's leaderboard page by page until it finds
        you. Finished sessions are checked once and remembered.
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
        ) : ended.length ? (
          <Panel className="divide-y divide-line overflow-hidden">
            {ended.slice(0, 40).map((s) => {
              const r = resultFor(s);
              const row = r.scan?.found[me.id];
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
                    {row ? (
                      <span className="nums font-display text-lg font-bold">{ordinal(row.rank)}</span>
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
          <Empty>No finished sessions match.</Empty>
        )}
      </div>
    </div>
  );
}
