import { Link, useParams } from 'react-router';
import { eventState, windowState } from '../../lib/status';
import { REGIONS, isRegion, type EventInfo, type EventWindow, type Region } from '../../lib/types';
import { eventTags } from '../components/EventCard';
import { Card, Countdown, LoadState, Pill, SectionTitle, StateBadge, TAG } from '../components/ui';
import { formatRange, REGION_LABEL, useNow } from '../format';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';

const PLATFORM_LABEL = { PC: 'PC', CONSOLE: 'Console', MOBILE: 'Mobile', CLOUD: 'Cloud' } as const;

/** Region from the ID suffix, used when the event isn't visible in the selected region. */
function suffixRegion(id: string): Region | undefined {
  const r = new RegExp(`_(${REGIONS.join('|')})$`).exec(id)?.[1];
  return isRegion(r) ? r : undefined;
}

function SessionRow({ w, now, showRules }: { w: EventWindow; now: Date; showRules: boolean }) {
  const [{ timeZone }] = useSettings();
  const state = windowState(w, now);
  return (
    <li className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{w.label}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatRange(w.begin, w.end, timeZone)}
            {w.isTBD && ' (times to be confirmed)'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
          <StateBadge state={state} />
          {state === 'upcoming' && <Countdown to={w.begin} now={now} />}
          {state === 'live' && <Countdown to={w.end} now={now} prefix="ends in" />}
        </div>
      </div>
      {showRules && w.requirements.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
          {w.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Detail({ event, now }: { event: EventInfo; now: Date }) {
  const [{ region }] = useSettings();
  const rounds = [...new Set(event.windows.map((w) => w.round))].sort((a, b) => a - b);
  const sameRules = event.windows.every((w) => w.requirements.join('|') === event.windows[0]!.requirements.join('|'));
  const sharedRules = sameRules ? event.windows[0]!.requirements : [];
  return (
    <div>
      <div className="flex gap-4">
        {event.posterUrl && (
          <img
            src={event.posterUrl}
            alt=""
            className="size-24 shrink-0 rounded-xl object-cover sm:size-32"
            loading="lazy"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-semibold">{event.name}</h1>
          {event.subtitle && <p className="text-sm text-zinc-600 dark:text-zinc-400">{event.subtitle}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            <StateBadge state={eventState(event.windows, now)} />
            {eventTags(event, region).map((t) => (
              <Pill key={t} className={TAG}>
                {t}
              </Pill>
            ))}
          </div>
        </div>
      </div>
      {event.description && <p className="mt-4 text-sm text-zinc-700 dark:text-zinc-300">{event.description}</p>}

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-zinc-500">Region</dt>
        <dd>{event.homeRegion === 'GLOBAL' ? 'Global' : REGION_LABEL[event.homeRegion]}</dd>
        <dt className="text-zinc-500">Platforms</dt>
        <dd>{event.platforms.map((p) => PLATFORM_LABEL[p]).join(', ')}</dd>
        {event.minAccountLevel && (
          <>
            <dt className="text-zinc-500">Account level</dt>
            <dd>{event.minAccountLevel}+</dd>
          </>
        )}
      </dl>

      {sharedRules.length > 0 && (
        <>
          <SectionTitle>Entry rules</SectionTitle>
          <ul className="list-inside list-disc text-sm text-zinc-700 dark:text-zinc-300">
            {sharedRules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}

      {rounds.map((round) => (
        <section key={round}>
          <SectionTitle>{rounds.length > 1 ? `Round ${round}` : 'Sessions'}</SectionTitle>
          <Card>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {event.windows
                .filter((w) => w.round === round)
                .map((w) => (
                  <SessionRow key={w.id} w={w} now={now} showRules={!sameRules} />
                ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}

export default function EventDetail() {
  const eventId = decodeURIComponent(useParams().eventId ?? '');
  const [{ region }] = useSettings();
  const now = useNow();
  const here = useEvents();
  const inHere = here.data?.events.find((e) => e.id === eventId);
  // Not visible in the selected region: look in the event's own region.
  const home = suffixRegion(eventId);
  const fallback = useEvents(home && home !== region ? home : region);
  const event = inHere ?? fallback.data?.events.find((e) => e.id === eventId);

  if (event) return <Detail event={event} now={now} />;
  if (here.loading || fallback.loading || here.error) {
    return <LoadState loading={here.loading || fallback.loading} error={here.error} onRetry={here.reload} />;
  }
  return (
    <Card className="p-4 text-sm">
      <p>This event isn't in this season's schedule anymore.</p>
      <Link to="/events" className="mt-2 inline-block font-medium text-blue-600 underline dark:text-blue-400">
        Back to events
      </Link>
    </Card>
  );
}
