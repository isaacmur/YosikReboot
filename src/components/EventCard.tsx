// Event cards with their tournament art: a large poster card (live and
// featured events), a grid tile (Events list) and a compact row (lists).

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { eventState, nextWindow, windowState } from '../../lib/status';
import type { EventInfo, EventWindow, Region } from '../../lib/types';
import { formatDay, formatTime, MODE_LABEL, TEAM_LABEL, TYPE_LABEL, zoneAbbrev } from '../format';
import { eventPath } from '../links';
import { useSettings } from '../settings';
import { ChevronRight } from './icons';
import { Art, Chip, Countdown, StateTag } from './ui';

/** Tags for a card or header. The home region is shown when it isn't the region being viewed. */
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

/** What's happening with an event right now, in one line. */
export function SessionLine({ event, now }: { event: EventInfo; now: Date }) {
  const [{ timeZone }] = useSettings();
  const live = event.windows.find((w) => windowState(w, now) === 'live');
  const wrapping = event.windows.find((w) => windowState(w, now) === 'wrapping');
  const next = nextWindow(event.windows, now);
  const last = event.windows[event.windows.length - 1];
  if (live)
    return (
      <>
        {live.label} · <Countdown to={live.end} now={now} prefix="ends in" />
      </>
    );
  if (wrapping) return <>{wrapping.label} · results settling</>;
  if (next)
    return (
      <>
        {next.label} · {formatDay(next.begin, timeZone)}, {formatTime(next.begin, timeZone)}{' '}
        {zoneAbbrev(timeZone, next.begin)} · <Countdown to={next.begin} now={now} />
      </>
    );
  return last ? <>Ended {formatDay(last.end, timeZone)}</> : null;
}

/** Big poster card: art across the whole card, title over it. */
export function PosterCard({ event, now, className = '' }: { event: EventInfo; now: Date; className?: string }) {
  const [{ region }] = useSettings();
  return (
    <Link
      to={eventPath(event.id)}
      className={`group relative block aspect-[16/10] overflow-hidden rounded-xl border border-line bg-surface sm:aspect-[16/8] ${className}`}
    >
      <Art
        art={event.art}
        kind="tile"
        width={720}
        fill
        imgClassName="transition duration-700 group-hover:scale-[1.04]"
      />
      <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/35 to-transparent" aria-hidden />
      <div className="absolute top-3 left-3">
        <StateTag state={eventState(event.windows, now)} />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        <div className="flex flex-wrap gap-1">
          {eventTags(event, region)
            .slice(0, 4)
            .map((t) => (
              <Chip key={t} tone="onArt">
                {t}
              </Chip>
            ))}
        </div>
        <h3 className="mt-1.5 line-clamp-2 font-display text-2xl leading-[0.95] font-bold tracking-wide uppercase sm:text-3xl">
          {event.name}
        </h3>
        <p className="nums mt-1.5 flex items-center gap-1 text-xs font-semibold text-white/80">
          <span className="truncate">
            <SessionLine event={event} now={now} />
          </span>
          <ChevronRight size={14} className="ml-auto shrink-0 transition group-hover:translate-x-0.5" />
        </p>
      </div>
    </Link>
  );
}

/** Grid tile: 16:9 art on top, details below. */
export function EventTile({ event, now }: { event: EventInfo; now: Date }) {
  const [{ region }] = useSettings();
  return (
    <Link
      to={eventPath(event.id)}
      className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition hover:border-line-strong hover:bg-raised/40"
    >
      <div className="relative aspect-video overflow-hidden">
        <Art
          art={event.art}
          kind="tile"
          width={400}
          fill
          imgClassName="transition duration-500 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/50 to-transparent" aria-hidden />
        <div className="absolute top-2 left-2">
          <StateTag state={eventState(event.windows, now)} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 font-display text-lg leading-tight font-bold tracking-wide uppercase">
          {event.name}
        </h3>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {eventTags(event, region).map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
        <p className="nums mt-auto pt-2.5 text-xs text-muted">
          <SessionLine event={event} now={now} />
        </p>
      </div>
    </Link>
  );
}

/** Compact row with a square thumbnail. `to` defaults to the event page. */
export function EventRow({
  event,
  sub,
  right,
  to,
  window: w,
}: {
  event: EventInfo;
  sub?: ReactNode;
  right?: ReactNode;
  to?: string;
  window?: EventWindow;
}) {
  return (
    <Link
      to={to ?? eventPath(event.id, w?.id)}
      className="group flex items-center gap-3 px-3 py-2.5 transition hover:bg-raised/60"
    >
      <Art art={event.art} kind="square" width={56} className="size-12 shrink-0 rounded-md ring-1 ring-line" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{event.name}</span>
        {sub && <span className="nums block truncate text-xs text-muted">{sub}</span>}
      </span>
      {right && <span className="nums shrink-0 text-right text-sm">{right}</span>}
      <ChevronRight
        size={16}
        className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-muted"
      />
    </Link>
  );
}
