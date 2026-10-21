// Event search results (F8) across every region: each event, with the sessions
// the query picked out ("round 2", "oct 18") listed under it.

import { Link } from 'react-router';
import { eventState, windowState } from '../../lib/status';
import { formatDay, formatTime, plural, zoneAbbrev } from '../format';
import { eventPath } from '../links';
import type { SearchHit } from '../search';
import { useSettings } from '../settings';
import { EventRow, SessionLine } from './EventCard';
import { ChevronRight } from './icons';
import { Empty, ListSkeleton, Panel, StageTag, StateTag } from './ui';

const SHOWN = 40;

export function SearchResults({
  hits,
  query,
  loading,
  now,
}: {
  hits: SearchHit[];
  query: string;
  /** Some regions are still loading. */
  loading: boolean;
  now: Date;
}) {
  const [{ timeZone }] = useSettings();
  if (!hits.length) return loading ? <ListSkeleton rows={4} /> : <Empty>Nothing this season matches "{query}".</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {plural(hits.length, 'event')} across all regions{loading ? ', more loading' : ''}
        {hits.length > SHOWN ? `, best ${SHOWN} shown` : ''}
      </p>
      {hits.slice(0, SHOWN).map(({ event, windows }) => (
        <Panel key={event.id} className="divide-y divide-line overflow-hidden">
          <EventRow
            event={event}
            sub={
              <>
                {event.homeRegion !== 'GLOBAL' && `${event.homeRegion} · `}
                <SessionLine event={event} now={now} />
              </>
            }
            right={<StateTag state={eventState(event.windows, now)} />}
          />
          {windows.length > 0 && (
            <ul className="divide-y divide-line bg-bg/40">
              {windows.slice(0, 6).map((w) => (
                <li key={w.id}>
                  <Link
                    to={eventPath(event.id, w.id)}
                    className="flex items-center gap-3 py-2 pr-3 pl-[4.25rem] text-sm transition hover:bg-raised/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{w.label}</span>
                        <StageTag stage={w.stage} />
                      </span>
                      <span className="nums block truncate text-xs text-muted">
                        {formatDay(w.begin, timeZone)}, {formatTime(w.begin, timeZone)} {zoneAbbrev(timeZone, w.begin)}
                      </span>
                    </span>
                    <StateTag state={windowState(w, now)} />
                    <ChevronRight size={15} className="shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
              {windows.length > 6 && (
                <li className="py-1.5 pr-3 pl-[4.25rem] text-xs text-faint">
                  and {plural(windows.length - 6, 'more session')}
                </li>
              )}
            </ul>
          )}
        </Panel>
      ))}
    </div>
  );
}
