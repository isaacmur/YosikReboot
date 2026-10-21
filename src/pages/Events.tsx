import { useSearchParams } from 'react-router';
import { eventState, nextWindow, type EventState } from '../../lib/status';
import { EVENT_TYPES, type EventInfo } from '../../lib/types';
import { EventTile } from '../components/EventCard';
import { Button, Empty, LoadState, PageTitle, PillSelect, SectionHeader, Skeleton, Tabs } from '../components/ui';
import { dayIndex, formatAgo, MODE_LABEL, REGION_LABEL, TEAM_LABEL, TYPE_LABEL, useNow } from '../format';
import { useSettings } from '../settings';
import { useEvents } from '../useEvents';

const TABS: { id: EventState; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'live', label: 'Live' },
  { id: 'ended', label: 'Ended' },
];

/** Filter definitions: URL param, label, options, and the test each option applies (F3). */
const FILTERS: { key: string; label: string; options: [string, string, (e: EventInfo) => boolean][] }[] = [
  { key: 'type', label: 'Type', options: EVENT_TYPES.map((t) => [t, TYPE_LABEL[t], (e) => e.type === t]) },
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

/** When an event sorts and groups in a tab: its next start (upcoming), its live end (live), its last end (ended). */
function when(e: EventInfo, state: EventState, now: Date): string {
  if (state === 'ended') return e.windows[e.windows.length - 1]!.end;
  const next = nextWindow(e.windows, now);
  return next ? (state === 'live' ? next.end : next.begin) : e.windows[0]!.begin;
}

/** Broad buckets, so a quiet week doesn't turn into a column of one-card days. */
function bucket(iso: string, now: Date, tz: string): string {
  const days = dayIndex(iso, tz) - dayIndex(now, tz);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1) return days < 7 ? 'This week' : 'Later';
  return days > -7 ? 'Earlier this week' : 'Older';
}

export default function Events() {
  const [{ region, timeZone }] = useSettings();
  const { data, error, loading, reload } = useEvents();
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'upcoming';

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const active = FILTERS.filter((f) => params.get(f.key));

  const filtered = (data?.events ?? []).filter((e) =>
    FILTERS.every(({ key, options }) => {
      const chosen = options.find(([v]) => v === params.get(key));
      return !chosen || chosen[2](e);
    }),
  );
  const byState = (s: EventState) => filtered.filter((e) => eventState(e.windows, now) === s);
  const shown = byState(tab).sort((a, b) => {
    const d = when(a, tab, now).localeCompare(when(b, tab, now));
    return tab === 'ended' ? -d : d;
  });
  const groups: [string, EventInfo[]][] = [];
  for (const e of shown) {
    const label = tab === 'live' ? '' : bucket(when(e, tab, now), now, timeZone);
    const g = groups[groups.length - 1];
    if (g && g[0] === label) g[1].push(e);
    else groups.push([label, [e]]);
  }

  return (
    <div>
      <PageTitle
        sub={
          data
            ? `${REGION_LABEL[region]} · ${data.events.length} events · updated ${formatAgo(data.fetchedAt, now)}`
            : REGION_LABEL[region]
        }
      >
        Events
      </PageTitle>

      <Tabs
        label="Event state"
        value={tab}
        onChange={(t) => set('tab', t === 'upcoming' ? '' : t)}
        tabs={TABS.map((t) => ({
          id: t.id,
          label: (
            <>
              {t.label} <span className="nums text-faint">{data ? byState(t.id).length : ''}</span>
            </>
          ),
        }))}
      />

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map(({ key, label, options }) => (
          <PillSelect
            key={key}
            aria-label={label}
            value={params.get(key) ?? ''}
            onChange={(e) => set(key, e.target.value)}
            tone={params.get(key) ? 'active' : 'plain'}
            className="shrink-0"
          >
            <option value="">{label}: all</option>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </PillSelect>
        ))}
        {active.length > 0 && (
          <Button
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              const next = new URLSearchParams(params);
              for (const f of FILTERS) next.delete(f.key);
              setParams(next, { replace: true });
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {!data ? (
        loading && !error ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3.4]" />
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <LoadState loading={loading} error={error} onRetry={reload} />
          </div>
        )
      ) : shown.length ? (
        groups.map(([label, list]) => (
          <section key={label || 'all'} className="mt-5">
            {label && <SectionHeader title={label} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((e) => (
                <EventTile key={e.id} event={e} now={now} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="mt-5">
          <Empty>
            No {tab} events{active.length ? ' match these filters' : ` in ${REGION_LABEL[region]}`}.
          </Empty>
        </div>
      )}
    </div>
  );
}
