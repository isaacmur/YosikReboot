import { Link } from 'react-router';
import { eventState, latestWindow, windowState } from '../../lib/status';
import type { EventInfo, EventWindow } from '../../lib/types';
import { EventRow, PosterCard } from '../components/EventCard';
import { ChevronRight } from '../components/icons';
import { Chip, Countdown, Empty, LoadState, Panel, SectionHeader, Skeleton } from '../components/ui';
import { formatAgo, formatDay, formatTime, ordinal, REGION_LABEL, useNow, zoneAbbrev } from '../format';
import { useFollows } from '../follows';
import { eventPath } from '../links';
import { allScans, useScans } from '../scan';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';

const DAY_MS = 86_400_000;

function LiveStrip({ events, now }: { events: EventInfo[]; now: Date }) {
  if (events.length === 1) return <PosterCard event={events[0]!} now={now} />;
  return (
    <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
      {events.map((e) => (
        <PosterCard key={e.id} event={e} now={now} className="w-[86%] shrink-0 snap-start sm:w-[calc(50%-0.375rem)]" />
      ))}
    </div>
  );
}

function FollowsPanel() {
  const follows = useFollows();
  const [{ timeZone }] = useSettings();
  useScans();
  if (!follows.length)
    return (
      <Empty
        action={
          <Link to="/follows" className="font-semibold text-accent-bright hover:underline">
            Follow players
          </Link>
        }
      >
        Follow players to see where they placed.
      </Empty>
    );
  const scans = allScans();
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-line">
        {follows.slice(0, 8).map((f) => {
          const latest = scans.find((x) => x.found[f.id]);
          const row = latest?.found[f.id];
          const inner = (
            <>
              <span className="skew grid size-8 shrink-0 place-items-center rounded-[4px] bg-raised">
                <span className="font-display text-base font-bold text-accent-bright">
                  {f.name.slice(0, 1).toUpperCase()}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{f.name}</span>
                  {f.isMe && <Chip tone="accent">You</Chip>}
                </span>
                <span className="block truncate text-xs text-muted">
                  {latest
                    ? `${latest.title ?? latest.windowId}${latest.endedAt ? ` · ${formatDay(latest.endedAt, timeZone)}` : ''}${latest.final ? '' : ' · live'}`
                    : 'No results found yet'}
                </span>
              </span>
              <span className="nums shrink-0 font-display text-lg font-bold">{row ? ordinal(row.rank) : '—'}</span>
            </>
          );
          return (
            <li key={f.id}>
              <Link
                to={`/players/${f.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-raised/60"
              >
                {inner}
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export default function Home() {
  const [{ region, timeZone }] = useSettings();
  const { data, error, loading, reload } = useEvents();
  const now = useNow();

  if (!data)
    return loading && !error ? (
      <div className="space-y-4">
        <Skeleton className="aspect-[16/10] rounded-xl sm:aspect-[16/8]" />
        <Skeleton className="h-48" />
      </div>
    ) : (
      <LoadState loading={loading} error={error} onRetry={reload} />
    );

  const live = data.events
    .filter((e) => eventState(e.windows, now) === 'live')
    .sort((a, b) =>
      (latestWindow(b.windows, now)?.begin ?? '').localeCompare(latestWindow(a.windows, now)?.begin ?? ''),
    );
  const upcoming: [EventInfo, EventWindow][] = data.events
    .flatMap((e) =>
      e.windows.filter((w) => windowState(w, now) === 'upcoming').map((w) => [e, w] as [EventInfo, EventWindow]),
    )
    .sort((a, b) => a[1].begin.localeCompare(b[1].begin));
  const finished: [EventInfo, EventWindow][] = data.events
    .flatMap((e) => {
      const w = latestWindow(e.windows, now);
      return w && windowState(w, now) === 'final' && now.getTime() - Date.parse(w.end) < DAY_MS
        ? [[e, w] as [EventInfo, EventWindow]]
        : [];
    })
    .sort((a, b) => b[1].end.localeCompare(a[1].end));
  const featured = upcoming[0]?.[0];

  return (
    <div>
      <SectionHeader
        title={live.length ? `Live now · ${live.length}` : 'Up next'}
        action={
          <span className="text-xs text-faint">
            {REGION_LABEL[region]} · updated {formatAgo(data.fetchedAt, now)}
          </span>
        }
      />
      {live.length ? (
        <LiveStrip events={live} now={now} />
      ) : featured ? (
        <PosterCard event={featured} now={now} />
      ) : (
        <Empty>Nothing live or scheduled in {REGION_LABEL[region]} right now.</Empty>
      )}

      <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-2">
        <section>
          <SectionHeader title="Starting soon" />
          {upcoming.length ? (
            <Panel className="divide-y divide-line overflow-hidden">
              {upcoming.slice(0, 5).map(([e, w]) => (
                <EventRow
                  key={w.id}
                  event={e}
                  window={w}
                  to={eventPath(e.id)}
                  sub={`${w.label} · ${formatDay(w.begin, timeZone)}, ${formatTime(w.begin, timeZone)} ${zoneAbbrev(timeZone, w.begin)}`}
                  right={
                    <span className="font-semibold text-accent-bright">
                      <Countdown to={w.begin} now={now} prefix="" />
                    </span>
                  }
                />
              ))}
            </Panel>
          ) : (
            <Empty>No upcoming sessions listed.</Empty>
          )}
        </section>

        <section>
          <SectionHeader title="Just finished" />
          {finished.length ? (
            <Panel className="divide-y divide-line overflow-hidden">
              {finished.slice(0, 5).map(([e, w]) => (
                <EventRow
                  key={w.id}
                  event={e}
                  window={w}
                  sub={`${w.label} · ended ${formatAgo(w.end, now)}`}
                  right={<span className="text-xs font-semibold text-muted">Results</span>}
                />
              ))}
            </Panel>
          ) : (
            <Empty>No sessions finished in the last day.</Empty>
          )}
        </section>
      </div>

      <SectionHeader
        title="Your follows"
        action={
          <Link to="/follows" className="text-xs font-semibold text-accent-bright hover:underline">
            Manage
          </Link>
        }
      />
      <FollowsPanel />
      <p className="mt-2 text-xs text-faint">
        Ranks come from boards you've searched: Find on all pages on a leaderboard, or Check on Me.
      </p>

      <Link
        to="/events"
        className="mt-8 flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 font-display text-lg font-bold tracking-wide uppercase transition hover:border-accent/60"
      >
        All events in {REGION_LABEL[region]}
        <ChevronRight size={18} className="text-accent-bright" />
      </Link>
    </div>
  );
}
