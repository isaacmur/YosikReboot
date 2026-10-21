import { Link } from 'react-router';
import { eventState, windowState } from '../../lib/status';
import type { EventInfo, EventWindow } from '../../lib/types';
import { EventCard } from '../components/EventCard';
import { Card, Countdown, LoadState, SectionTitle } from '../components/ui';
import { formatAgo, formatDateTime, formatDay, ordinal, REGION_LABEL, useNow, zoneAbbrev } from '../format';
import { useFollows } from '../follows';
import { allScans, useScans } from '../scan';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';

export default function Home() {
  const [{ region, timeZone }] = useSettings();
  const { data, error, loading, reload } = useEvents();
  const now = useNow();
  const follows = useFollows();
  useScans();
  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} />;

  const live = data.events.filter((e) => eventState(e.windows, now) === 'live');
  const upcoming: [EventInfo, EventWindow][] = data.events
    .flatMap((e) =>
      e.windows.filter((w) => windowState(w, now) === 'upcoming').map((w) => [e, w] as [EventInfo, EventWindow]),
    )
    .sort((a, b) => a[1].begin.localeCompare(b[1].begin))
    .slice(0, 3);

  return (
    <div>
      <p className="text-xs text-zinc-500">
        {REGION_LABEL[region]} schedule · updated {formatAgo(data.fetchedAt, now)}
      </p>
      <SectionTitle>Live now</SectionTitle>
      {live.length ? (
        <div className="space-y-2">
          {live.map((e) => (
            <EventCard key={e.id} event={e} now={now} />
          ))}
        </div>
      ) : (
        <Card className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
          Nothing live in {REGION_LABEL[region]} right now.
        </Card>
      )}
      <SectionTitle>Next up</SectionTitle>
      {upcoming.length ? (
        <Card className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {upcoming.map(([e, w]) => (
            <Link
              key={w.id}
              to={`/events/${encodeURIComponent(e.id)}`}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{e.name}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {w.label} · {formatDateTime(w.begin, timeZone)} {zoneAbbrev(timeZone, w.begin)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium">
                <Countdown to={w.begin} now={now} />
              </span>
            </Link>
          ))}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-zinc-600 dark:text-zinc-400">No upcoming sessions listed.</Card>
      )}
      <SectionTitle>Your follows</SectionTitle>
      {follows.length ? (
        <Card className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {follows.slice(0, 10).map((f) => {
            const latest = allScans().find((x) => x.found[f.id]);
            const row = latest?.found[f.id];
            return (
              <div key={f.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {f.name}
                    {f.isMe && <span className="font-normal text-zinc-500"> (you)</span>}
                  </span>
                  {latest && (
                    <span className="block truncate text-xs text-zinc-500">
                      {latest.title ?? latest.windowId}
                      {latest.endedAt ? ` · ${formatDay(latest.endedAt, timeZone)}` : ''}
                      {latest.final ? '' : ' · live'}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{row ? ordinal(row.rank) : '—'}</span>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
          <Link to="/follows" className="font-medium text-blue-600 underline dark:text-blue-400">
            Follow players
          </Link>{' '}
          to see where they placed.
        </Card>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Ranks come from boards you've searched (Leaderboard → Find on all pages, or Me → Check).{' '}
        <Link to="/follows" className="underline">
          Manage follows
        </Link>
      </p>

      <p className="mt-6 text-sm">
        <Link to="/events" className="font-medium text-blue-600 underline dark:text-blue-400">
          All events in {REGION_LABEL[region]}
        </Link>
      </p>
    </div>
  );
}
