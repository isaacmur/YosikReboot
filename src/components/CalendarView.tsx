// Calendar (F4): every session in a month grid or a week, in your time zone.
// The month shows dots on phones and session names on wider screens; tapping a
// day lists its sessions below. The week is a day-by-day agenda.

import { useMemo, useState } from 'react';
import { windowState } from '../../lib/status';
import type { EventInfo, EventType, Region } from '../../lib/types';
import {
  dayFromKey,
  dayKey,
  dayLabel,
  dayOfMonth,
  monthLabel,
  monthWeeks,
  sameMonth,
  sessionsByDay,
  shiftMonth,
  weekDays,
  type DaySession,
} from '../calendar';
import { dayIndex, formatTime, REGION_LABEL, STAGE_LABEL, zoneAbbrev } from '../format';
import { EventRow } from './EventCard';
import { FeedPanel } from './Feed';
import { ChevronLeft, ChevronRight } from './icons';
import { Button, Empty, Panel, Segmented, Sheet, StateTag } from './ui';

export type CalendarMode = 'month' | 'week';

/** Status colors for a session's dot: live, coming up, or over. */
const DOT: Record<string, string> = { live: 'bg-live', wrapping: 'bg-wrap', upcoming: 'bg-soon', final: 'bg-final' };

function Agenda({ list, now, tz, showRegion }: { list: DaySession[]; now: Date; tz: string; showRegion: boolean }) {
  if (!list.length) return <p className="px-1 py-2 text-sm text-faint">No sessions.</p>;
  return (
    <Panel className="divide-y divide-line overflow-hidden">
      {list.map(({ event, w }) => (
        <EventRow
          key={w.id}
          event={event}
          window={w}
          sub={
            <>
              {showRegion && event.homeRegion !== 'GLOBAL' && `${event.homeRegion} · `}
              {event.windows.length > 1 && `${w.label} · `}
              {STAGE_LABEL[w.stage]} · {formatTime(w.begin, tz)} – {formatTime(w.end, tz)} {zoneAbbrev(tz, w.begin)}
            </>
          }
          right={<StateTag state={windowState(w, now)} />}
        />
      ))}
    </Panel>
  );
}

export function CalendarView({
  events,
  now,
  tz,
  mode,
  day,
  onChange,
  region,
  allRegions,
  type,
}: {
  events: EventInfo[];
  now: Date;
  tz: string;
  mode: CalendarMode;
  /** "2026-10-21", or null for today. */
  day: string | null;
  onChange: (patch: { cal?: CalendarMode; day?: string | null }) => void;
  region: Region;
  allRegions: boolean;
  /** The type filter, for the feed link. */
  type?: EventType;
}) {
  const today = dayIndex(now, tz);
  const selected = dayFromKey(day) ?? today;
  const byDay = useMemo(() => sessionsByDay(events, tz), [events, tz]);
  const [feed, setFeed] = useState(false);
  const pick = (d: number) => onChange({ day: d === today ? null : dayKey(d) });
  const step = (by: number) => pick(mode === 'month' ? shiftMonth(selected, by) : selected + 7 * by);
  const week = weekDays(selected);
  const title = mode === 'month' ? monthLabel(selected) : `${dayLabel(week[0]!)} – ${dayLabel(week[6]!)}`;
  const arrow =
    'grid size-9 shrink-0 place-items-center rounded-md border border-line-strong bg-raised text-muted hover:text-ink';

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <button className={arrow} onClick={() => step(-1)} aria-label={`Previous ${mode}`}>
            <ChevronLeft size={16} />
          </button>
          <button className={arrow} onClick={() => step(1)} aria-label={`Next ${mode}`}>
            <ChevronRight size={16} />
          </button>
          <h2 className="ml-1.5 font-display text-xl leading-none font-bold tracking-wide uppercase" aria-live="polite">
            {title}
          </h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selected !== today && (
            <Button size="sm" variant="ghost" onClick={() => pick(today)}>
              Today
            </Button>
          )}
          <Button size="sm" onClick={() => setFeed(true)}>
            Subscribe
          </Button>
        </div>
      </div>
      <Segmented
        label="Calendar range"
        items={[
          { id: 'month', label: 'Month' },
          { id: 'week', label: 'Week' },
        ]}
        value={mode}
        onChange={(cal) => onChange({ cal })}
      />

      {mode === 'month' ? (
        <>
          <Panel className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line text-center text-[10px] font-semibold tracking-wider text-faint uppercase">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <span key={d} className="py-1.5">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthWeeks(selected).flatMap((w) =>
                w.map((d) => {
                  const list = byDay.get(d) ?? [];
                  const isSel = d === selected;
                  return (
                    <button
                      key={d}
                      onClick={() => pick(d)}
                      aria-pressed={isSel}
                      aria-label={`${dayLabel(d)}: ${list.length} session${list.length === 1 ? '' : 's'}`}
                      className={`flex min-h-14 min-w-0 flex-col items-stretch gap-1 border-t border-l border-line p-1 text-left transition first:border-l-0 hover:bg-raised/60 sm:min-h-24 sm:p-1.5 [&:nth-child(7n+1)]:border-l-0 ${isSel ? 'bg-accent-soft' : ''} ${sameMonth(d, selected) ? '' : 'opacity-45'}`}
                    >
                      <span
                        className={`nums grid size-6 place-items-center rounded-full text-xs font-semibold ${d === today ? 'bg-accent text-accent-ink' : ''}`}
                      >
                        {dayOfMonth(d)}
                      </span>
                      {/* Phones: a dot per session (up to 4) and a count. */}
                      {list.length > 0 && (
                        <span className="flex flex-wrap items-center gap-0.5 sm:hidden">
                          {list.slice(0, 4).map(({ w }) => (
                            <span key={w.id} className={`size-1.5 rounded-full ${DOT[windowState(w, now)]}`} />
                          ))}
                          {list.length > 4 && <span className="text-[9px] text-faint">+{list.length - 4}</span>}
                        </span>
                      )}
                      {/* Wider screens: the first sessions by name. */}
                      <span className="hidden min-w-0 space-y-0.5 sm:block">
                        {list.slice(0, 3).map(({ event, w }) => (
                          <span key={w.id} className="flex min-w-0 items-center gap-1 text-[11px] leading-tight">
                            <span className={`size-1.5 shrink-0 rounded-full ${DOT[windowState(w, now)]}`} />
                            <span className="nums shrink-0 text-faint">
                              {formatTime(w.begin, tz).replace(':00', '')}
                            </span>
                            <span className="truncate">{event.name}</span>
                          </span>
                        ))}
                        {list.length > 3 && (
                          <span className="block text-[11px] text-faint">+{list.length - 3} more</span>
                        )}
                      </span>
                    </button>
                  );
                }),
              )}
            </div>
          </Panel>
          <section>
            <h3 className="mb-2 font-display text-lg leading-none font-bold tracking-wide uppercase">
              {selected === today ? 'Today' : dayLabel(selected)}
            </h3>
            <Agenda list={byDay.get(selected) ?? []} now={now} tz={tz} showRegion={allRegions} />
          </section>
        </>
      ) : (
        <div className="space-y-5">
          {week.map((d) => (
            <section key={d}>
              <h3
                className={`mb-2 font-display text-lg leading-none font-bold tracking-wide uppercase ${d === today ? 'text-accent-bright' : ''}`}
              >
                {d === today ? `Today · ${dayLabel(d)}` : dayLabel(d)}
              </h3>
              <Agenda list={byDay.get(d) ?? []} now={now} tz={tz} showRegion={allRegions} />
            </section>
          ))}
        </div>
      )}

      {!events.length && <Empty>No events match these filters.</Empty>}

      <Sheet open={feed} onClose={() => setFeed(false)} title="Calendar feed">
        <FeedPanel region={region} type={type} />
        {allRegions && (
          <p className="mt-3 text-xs text-faint">
            The feed covers one region at a time: {REGION_LABEL[region]}, from your settings.
          </p>
        )}
      </Sheet>
    </div>
  );
}
