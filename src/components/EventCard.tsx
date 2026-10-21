import { Link } from 'react-router';
import { eventState, nextWindow, windowState } from '../../lib/status';
import type { EventInfo, Region } from '../../lib/types';
import { formatDateTime, formatDay, MODE_LABEL, TEAM_LABEL, TYPE_LABEL, zoneAbbrev } from '../format';
import { useSettings } from '../settings';
import { Countdown, Pill, StateBadge, TAG } from './ui';

/** Tags for a card or detail header. The home region is shown when it isn't the region being viewed. */
export function eventTags(e: EventInfo, viewing?: Region): string[] {
  const tags: string[] = [];
  if (e.homeRegion !== 'GLOBAL' && e.homeRegion !== viewing && !e.name.startsWith(`[${e.homeRegion}]`)) {
    tags.push(e.homeRegion);
  }
  tags.push(TYPE_LABEL[e.type]);
  if (e.mode !== 'OTHER') tags.push(MODE_LABEL[e.mode]);
  if (e.zeroBuild) tags.push('Zero Build');
  if (e.teamSize) tags.push(TEAM_LABEL[e.teamSize]);
  if (e.mobileOnly) tags.push('Mobile');
  return tags;
}

export function EventCard({ event, now }: { event: EventInfo; now: Date }) {
  const [{ timeZone, region }] = useSettings();
  const state = eventState(event.windows, now);
  const live = event.windows.find((w) => windowState(w, now) === 'live');
  const wrapping = event.windows.find((w) => windowState(w, now) === 'wrapping');
  const next = nextWindow(event.windows, now);
  const last = event.windows[event.windows.length - 1]!;
  return (
    <Link
      to={`/events/${encodeURIComponent(event.id)}`}
      className="flex overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
    >
      <span className="w-1.5 shrink-0" style={{ backgroundColor: event.color ? `#${event.color}` : undefined }} />
      <div className="min-w-0 flex-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="leading-snug font-semibold">{event.name}</h3>
          <StateBadge state={state} />
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {eventTags(event, region).map((t) => (
            <Pill key={t} className={TAG}>
              {t}
            </Pill>
          ))}
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {live ? (
            <>
              {live.label} · <Countdown to={live.end} now={now} prefix="ends in" />
            </>
          ) : wrapping ? (
            <>{wrapping.label} · results settling</>
          ) : next ? (
            <>
              {next.label} · {formatDateTime(next.begin, timeZone)} {zoneAbbrev(timeZone, next.begin)} ·{' '}
              <Countdown to={next.begin} now={now} />
            </>
          ) : (
            <>Ended {formatDay(last.end, timeZone)}</>
          )}
        </p>
      </div>
    </Link>
  );
}
