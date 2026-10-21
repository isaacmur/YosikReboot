// The schedule (F1, F3) as a list by state, a calendar (F4), cutoff history by
// type in your region (F28), or search results across every region (F8). View,
// filters and query live in the URL.

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { eventState, nextWindow, type EventState } from '../../lib/status';
import { EVENT_TYPES, type EventInfo, type EventType } from '../../lib/types';
import { CalendarView, type CalendarMode } from '../components/CalendarView';
import { CutoffsView } from '../components/CutoffHistory';
import { EventTile } from '../components/EventCard';
import { SearchIcon } from '../components/icons';
import { SearchResults } from '../components/SearchResults';
import {
  Button,
  Empty,
  LoadState,
  PageTitle,
  PillSelect,
  SectionHeader,
  Segmented,
  Skeleton,
  Tabs,
} from '../components/ui';
import { dayIndex, formatAgo, MODE_LABEL, REGION_LABEL, TEAM_LABEL, TYPE_LABEL, useNow } from '../format';
import { searchEvents } from '../search';
import { useSettings } from '../settings';
import { useAllEvents, useEvents } from '../useEvents';

type View = 'list' | 'calendar' | 'cutoffs';
const VIEWS: { id: View; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'cutoffs', label: 'Cutoffs' },
];

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
  const view = VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'list';
  const query = params.get('q') ?? '';
  const searching = query.trim().length > 0;
  const allRegions = params.get('scope') === 'all';
  const everywhere = useAllEvents(searching || (view === 'calendar' && allRegions));

  const patch = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const set = (key: string, value: string) => patch({ [key]: value });
  const active = FILTERS.filter((f) => params.get(f.key));
  const passes = useCallback(
    (e: EventInfo) =>
      FILTERS.every(({ key, options }) => {
        const chosen = options.find(([v]) => v === params.get(key));
        return !chosen || chosen[2](e);
      }),
    [params],
  );
  const typeFilter = EVENT_TYPES.find((t) => t === params.get('type')) as EventType | undefined;

  const filtered = (data?.events ?? []).filter(passes);
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
  const everywhereFiltered = useMemo(() => everywhere.events.filter(passes), [everywhere.events, passes]);
  const hits = useMemo(
    () => (searching ? searchEvents(everywhereFiltered, query, timeZone, region) : []),
    [searching, everywhereFiltered, query, timeZone, region],
  );

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

      <label className="relative mb-3 block">
        <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search every region: events, sessions, dates"
          aria-label="Search events"
          className="h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent"
        />
      </label>

      {!searching && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented
            label="View"
            items={VIEWS}
            value={view}
            onChange={(v) => patch({ view: v === 'list' ? null : v })}
          />
          {view === 'calendar' && (
            <PillSelect
              aria-label="Calendar regions"
              value={allRegions ? 'all' : 'mine'}
              onChange={(e) => set('scope', e.target.value === 'all' ? 'all' : '')}
              tone={allRegions ? 'active' : 'plain'}
            >
              <option value="mine">{REGION_LABEL[region]}</option>
              <option value="all">All regions</option>
            </PillSelect>
          )}
        </div>
      )}

      {!searching && view === 'list' && (
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
      )}

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
            onClick={() => patch(Object.fromEntries(FILTERS.map((f) => [f.key, null])))}
          >
            Clear
          </Button>
        )}
      </div>

      {searching ? (
        <div className="mt-4">
          {everywhere.error && !everywhere.events.length ? (
            <LoadState loading={false} error={everywhere.error} />
          ) : (
            <SearchResults hits={hits} query={query.trim()} loading={everywhere.loading} now={now} />
          )}
        </div>
      ) : view === 'cutoffs' ? (
        data ? (
          <CutoffsView events={filtered} />
        ) : (
          <div className="mt-4">
            <LoadState loading={loading} error={error} onRetry={reload} />
          </div>
        )
      ) : view === 'calendar' ? (
        allRegions && everywhere.loading && !everywhere.events.length ? (
          <Skeleton className="mt-4 h-96" />
        ) : !allRegions && !data ? (
          <div className="mt-4">
            <LoadState loading={loading} error={error} onRetry={reload} />
          </div>
        ) : (
          <CalendarView
            events={allRegions ? everywhereFiltered : filtered}
            now={now}
            tz={timeZone}
            mode={params.get('cal') === 'week' ? 'week' : 'month'}
            day={params.get('day')}
            onChange={({ cal, day }) =>
              patch({
                ...(cal !== undefined ? { cal: cal === 'month' ? null : (cal as CalendarMode) } : {}),
                ...(day !== undefined ? { day } : {}),
              })
            }
            region={region}
            allRegions={allRegions}
            type={typeFilter}
          />
        )
      ) : !data ? (
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
