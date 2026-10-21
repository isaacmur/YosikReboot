import { useSearchParams } from 'react-router';
import { eventState, nextWindow, type EventState } from '../../lib/status';
import { EVENT_TYPES, type EventInfo } from '../../lib/types';
import { EventCard } from '../components/EventCard';
import { Card, LoadState, SELECT } from '../components/ui';
import { formatAgo, MODE_LABEL, REGION_LABEL, TEAM_LABEL, TYPE_LABEL, useNow } from '../format';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';

const TABS: [EventState, string][] = [
  ['upcoming', 'Upcoming'],
  ['live', 'Live'],
  ['ended', 'Ended'],
];

/** Filter definitions: URL param, label, options, and the test each option applies (F3). */
const FILTERS: { key: string; label: string; options: [string, string, (e: EventInfo) => boolean][] }[] = [
  {
    key: 'type',
    label: 'Type',
    options: EVENT_TYPES.map((t) => [t, TYPE_LABEL[t], (e) => e.type === t]),
  },
  {
    key: 'mode',
    label: 'Mode',
    options: [
      ['BR', MODE_LABEL.BR, (e) => e.mode === 'BR'],
      ['RELOAD', MODE_LABEL.RELOAD, (e) => e.mode === 'RELOAD'],
    ],
  },
  {
    key: 'build',
    label: 'Build',
    options: [
      ['build', 'Build', (e) => !e.zeroBuild],
      ['zb', 'Zero Build', (e) => e.zeroBuild],
    ],
  },
  {
    key: 'team',
    label: 'Team',
    options: ([1, 2, 3, 4] as const).map((n) => [String(n), TEAM_LABEL[n], (e) => e.teamSize === n]),
  },
  {
    key: 'platform',
    label: 'Platform',
    options: [
      ['mobile', 'Mobile cups', (e) => e.mobileOnly],
      ['nomobile', 'Not mobile-only', (e) => !e.mobileOnly],
    ],
  },
];

function sortKey(e: EventInfo, state: EventState, now: Date): number {
  if (state === 'ended') return -Date.parse(e.windows[e.windows.length - 1]!.end);
  const next = nextWindow(e.windows, now);
  return next ? Date.parse(state === 'live' ? next.end : next.begin) : Date.parse(e.windows[0]!.begin);
}

export default function Events() {
  const [{ region }] = useSettings();
  const { data, error, loading, reload } = useEvents();
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const tab = (TABS.find(([t]) => t === params.get('tab'))?.[0] ?? 'upcoming') as EventState;

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} />;

  const filtered = data.events.filter((e) =>
    FILTERS.every(({ key, options }) => {
      const chosen = options.find(([v]) => v === params.get(key));
      return !chosen || chosen[2](e);
    }),
  );
  const byState = (s: EventState) => filtered.filter((e) => eventState(e.windows, now) === s);
  const shown = byState(tab).sort((a, b) => sortKey(a, tab, now) - sortKey(b, tab, now));

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Events</h1>
        <p className="text-xs text-zinc-500">
          {REGION_LABEL[region]} · updated {formatAgo(data.fetchedAt, now)}
        </p>
      </div>

      <div role="tablist" className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-zinc-200 p-1 dark:bg-zinc-800">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => set('tab', t === 'upcoming' ? '' : t)}
            className={`rounded-md px-2 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {label} <span className="text-zinc-500">{byState(t).length}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map(({ key, label, options }) => (
          <select
            key={key}
            aria-label={label}
            value={params.get(key) ?? ''}
            onChange={(e) => set(key, e.target.value)}
            className={SELECT}
          >
            <option value="">{label}: all</option>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {shown.length ? (
          shown.map((e) => <EventCard key={e.id} event={e} now={now} />)
        ) : (
          <Card className="p-4 text-sm text-zinc-600 dark:text-zinc-400">No {tab} events match these filters.</Card>
        )}
      </div>
    </div>
  );
}
