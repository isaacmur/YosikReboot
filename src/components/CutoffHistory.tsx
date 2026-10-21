// Cutoff history (F28): what each qualifying or paid line took in every finished
// session of an event, as a table and, for the first line, a chart. Sessions are
// read on request, one at a time, and remembered for good (D25). The Events page
// lists every event of a type in your region with its history (type × region).

import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { EventInfo } from '../../lib/types';
import { finishedSessions, loadCutoffs, savedCutoffs, useCutoffHistory, type CutoffPoints } from '../cutoffHistory';
import { formatDay, plural } from '../format';
import { eventPath } from '../links';
import { useSettings } from '../settings';
import { LineChart } from './Charts';
import { Art, Button, Empty, Panel } from './ui';

export function CutoffHistory({ event }: { event: EventInfo }) {
  const [{ timeZone }] = useSettings();
  useCutoffHistory();
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<string>();
  const stop = useRef(false);
  const rows = finishedSessions(event.windows).map((w) => ({ w, c: savedCutoffs(event.id, w.id) }));
  const missing = rows.filter((r) => !r.c).map((r) => r.w);
  const columns: CutoffPoints[] = [];
  for (const { c } of rows)
    for (const line of c?.lines ?? []) if (!columns.some((x) => x.key === line.key)) columns.push(line);

  async function read() {
    stop.current = false;
    setError(undefined);
    setProgress({ done: 0, total: missing.length });
    try {
      for (const [i, w] of missing.entries()) {
        if (stop.current) break;
        await loadCutoffs(event.id, w);
        setProgress({ done: i + 1, total: missing.length });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(undefined);
    }
  }

  if (!rows.length) return <Empty>No finished sessions yet.</Empty>;
  const first = columns[0];
  const chart = first
    ? rows.flatMap(({ w, c }) => {
        const p = c?.lines.find((l) => l.key === first.key)?.points;
        return p == null ? [] : [{ value: p, label: `${w.label} · ${formatDay(w.end, timeZone)}` }];
      })
    : [];

  return (
    <div className="space-y-3">
      {(missing.length > 0 || progress) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            {progress
              ? `Reading ${progress.done + 1} of ${progress.total}…`
              : `${rows.length - missing.length} of ${plural(rows.length, 'finished session')} read`}
          </span>
          {progress ? (
            <Button size="sm" onClick={() => (stop.current = true)}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void read()}>
              Read {missing.length === rows.length ? 'cutoffs' : `the other ${missing.length}`}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-live">Stopped: {error}</p>}
      {!missing.length && !columns.length && (
        <Empty>This event's sessions have no qualifying, paid or skin places, only other item rewards.</Empty>
      )}
      {chart.length > 1 && first && (
        <Panel className="p-4">
          <LineChart title={`${first.title} · points it took`} points={chart} />
        </Panel>
      )}
      {columns.length > 0 && (
        <Panel className="overflow-x-auto">
          <table className="nums w-full text-sm">
            <caption className="sr-only">Points each line took, by session</caption>
            <thead>
              <tr className="border-b border-line text-[10px] tracking-wider text-faint uppercase">
                <th className="px-3 py-2 text-left font-semibold">Session</th>
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right font-semibold whitespace-nowrap" title={c.label}>
                    {c.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ w, c }) => (
                <tr key={w.id}>
                  <td className="px-3 py-2">
                    <Link
                      to={eventPath(event.id, w.id, c ? `board=${encodeURIComponent(c.board)}` : undefined)}
                      className="font-semibold hover:underline"
                    >
                      {w.label}
                    </Link>
                    <span className="block text-xs text-muted">{formatDay(w.end, timeZone)}</span>
                  </td>
                  {columns.map((col) => {
                    const p = c?.lines.find((l) => l.key === col.key);
                    return (
                      <td key={col.key} className="px-3 py-2 text-right font-semibold">
                        {!c ? (
                          <span className="font-normal text-faint">…</span>
                        ) : !p ? (
                          <span className="font-normal text-faint">—</span>
                        ) : p.points === null ? (
                          <span className="font-normal text-muted" title="Fewer teams finished than the line allows">
                            everyone
                          </span>
                        ) : (
                          p.points.toLocaleString('en-US')
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

/** Every event in view with finished sessions, newest first, each opening onto its cutoff history. */
export function CutoffsView({ events }: { events: EventInfo[] }) {
  const [{ timeZone }] = useSettings();
  const now = new Date();
  const withHistory = events
    .map((event) => ({ event, done: finishedSessions(event.windows, now) }))
    .filter((x) => x.done.length > 0)
    .sort((a, b) => b.done[b.done.length - 1]!.end.localeCompare(a.done[a.done.length - 1]!.end));
  if (!withHistory.length) return <Empty>No finished sessions match these filters.</Empty>;
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-muted">
        What it took to qualify or get paid in each finished session. Pick a type above to compare like with like.
      </p>
      {withHistory.map(({ event, done }) => (
        <details key={event.id} className="group rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
            <Art art={event.art} kind="square" width={56} className="size-10 shrink-0 rounded-md ring-1 ring-line" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{event.name}</span>
              <span className="block truncate text-xs text-muted">
                {event.homeRegion !== 'GLOBAL' && `${event.homeRegion} · `}
                {plural(done.length, 'finished session')} · last {formatDay(done[done.length - 1]!.end, timeZone)}
              </span>
            </span>
            <span className="text-xs font-semibold text-accent-bright group-open:hidden">Show</span>
            <span className="hidden text-xs font-semibold text-accent-bright group-open:inline">Hide</span>
          </summary>
          <div className="border-t border-line p-3">
            <CutoffHistory event={event} />
          </div>
        </details>
      ))}
    </div>
  );
}
