// One tournament: an art hero, then the most recent session's leaderboard by
// default (live first, else the one that ended last). Session and region
// pickers switch the board; the other tabs hold the schedule and the rules.

import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { eventState, latestWindow, windowState } from '../../lib/status';
import {
  REGIONS,
  type EventInfo,
  type EventWindow,
  type Region,
  type WindowDetail,
  type WindowState,
} from '../../lib/types';
import { useApi } from '../api';
import { BoardPicker, Leaderboard, useBoardChoice } from '../components/Board';
import { CutoffHistory } from '../components/CutoffHistory';
import { MatchesTab } from '../components/MatchesTab';
import { finishedSessions } from '../cutoffHistory';
import { eventTags } from '../components/EventCard';
import { PrizesPanel, ScoringPanel } from '../components/Scoring';
import { ChevronLeft, ChevronRight, ClockIcon, GlobeIcon } from '../components/icons';
import {
  Art,
  Button,
  Chip,
  Countdown,
  Empty,
  ErrorNote,
  Panel,
  PillSelect,
  SectionHeader,
  Skeleton,
  StageTag,
  StateTag,
  Tabs,
} from '../components/ui';
import { formatDay, formatRange, formatTime, REGION_LABEL, STAGE_LABEL, useNow, zoneAbbrev } from '../format';
import { eventPath, inRegion, regionOf } from '../links';
import { showsPlacement } from '../placements';
import { useSettings } from '../settings';
import { useEvent } from '../useEvent';
import { useEvents } from '../useEvents';

type Tab = 'board' | 'matches' | 'sessions' | 'rules';
type DetailQuery = ReturnType<typeof useApi<WindowDetail>>;
const PLATFORM_LABEL = { PC: 'PC', CONSOLE: 'Console', MOBILE: 'Mobile', CLOUD: 'Cloud' } as const;

// --- Hero ------------------------------------------------------------------------

function Hero({ event, w, now }: { event: EventInfo; w?: EventWindow; now: Date }) {
  const [{ region, timeZone }] = useSettings();
  const navigate = useNavigate();
  // Back to wherever you came from; straight to the list when this page was opened directly.
  const cameFromApp = useLocation().key !== 'default';
  const first = event.windows[0];
  const last = event.windows[event.windows.length - 1];
  const span =
    first && last
      ? formatDay(first.begin, timeZone) === formatDay(last.end, timeZone)
        ? formatDay(first.begin, timeZone)
        : `${formatDay(first.begin, timeZone)} – ${formatDay(last.end, timeZone)}`
      : '';
  const here = regionOf(event.id);
  // Epic's CDN resizes art; ask for what this screen shows (the hero is at most 1024 px wide).
  const width = Math.min(globalThis.innerWidth || 1024, 1024);
  return (
    <section className="relative -mx-4 -mt-5 overflow-hidden sm:mx-0 sm:mt-0 sm:rounded-xl sm:border sm:border-line">
      <Art art={event.art} kind="background" width={width} fill imgClassName="opacity-80" />
      <div className="absolute inset-0 bg-linear-to-t from-bg via-bg/80 to-bg/5" aria-hidden />
      <div className="absolute inset-0 bg-linear-to-r from-bg/70 via-transparent to-transparent" aria-hidden />
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-4 pt-3 sm:px-5 sm:pt-4">
        <button
          onClick={() => (cameFromApp ? navigate(-1) : navigate('/events'))}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-white/20 bg-black/45 pr-3 pl-2 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/60"
        >
          <ChevronLeft size={16} /> Back
        </button>
        {here && <RegionSwitch event={event} w={w} here={here} />}
      </div>
      <div className="relative flex min-h-[16rem] items-end gap-4 px-4 pt-16 pb-5 sm:min-h-[20rem] sm:px-6 sm:pb-6">
        <Art
          art={event.art}
          kind="square"
          width={140}
          className="hidden size-28 shrink-0 rounded-lg shadow-2xl ring-1 ring-white/15 sm:block sm:size-36"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StateTag state={eventState(event.windows, now)} />
            {eventTags(event, region).map((t) => (
              <Chip key={t} tone="onArt">
                {t}
              </Chip>
            ))}
          </div>
          <h1 className="mt-2 font-display text-[2rem] leading-[0.95] font-bold tracking-wide text-balance uppercase sm:text-5xl">
            {event.name}
          </h1>
          {event.subtitle && <p className="mt-1.5 text-sm font-semibold text-muted">{event.subtitle}</p>}
          <p className="mt-1 text-xs text-muted">
            {span}
            {event.windows.length > 1 && ` · ${event.windows.length} sessions`}
            {first && ` · ${zoneAbbrev(timeZone, first.begin)}`}
          </p>
        </div>
      </div>
    </section>
  );
}

function HeroSkeleton() {
  return (
    <div className="-mx-4 -mt-5 sm:mx-0 sm:mt-0">
      <Skeleton className="h-64 rounded-none sm:h-80 sm:rounded-xl" />
      <Skeleton className="mt-4 h-9 w-64" />
      <Skeleton className="mt-6 h-96" />
    </div>
  );
}

// --- Session and region pickers ----------------------------------------------------

function sessionLabel(w: EventWindow, now: Date, tz: string): string {
  const s = windowState(w, now);
  const tag = s === 'live' ? ' · LIVE' : s === 'wrapping' ? ' · settling' : '';
  return `${w.label} · ${STAGE_LABEL[w.stage]} · ${formatDay(w.begin, tz)}${tag}`;
}

function SessionPicker({
  event,
  w,
  onPick,
  now,
}: {
  event: EventInfo;
  w: EventWindow;
  onPick: (w: EventWindow) => void;
  now: Date;
}) {
  const [{ timeZone }] = useSettings();
  const i = event.windows.findIndex((x) => x.id === w.id);
  const prev = event.windows[i - 1];
  const next = event.windows[i + 1];
  const rounds = [...new Set(event.windows.map((x) => x.round))].sort((a, b) => a - b);
  const options = (list: EventWindow[]) =>
    list.map((x) => (
      <option key={x.id} value={x.id}>
        {sessionLabel(x, now, timeZone)}
      </option>
    ));
  const step =
    'grid size-9 shrink-0 place-items-center rounded-md border border-line-strong bg-raised text-muted hover:text-ink disabled:opacity-35';
  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
      <button className={step} onClick={() => prev && onPick(prev)} disabled={!prev} aria-label="Previous session">
        <ChevronLeft size={16} />
      </button>
      <PillSelect
        aria-label="Session"
        value={w.id}
        onChange={(e) => onPick(event.windows.find((x) => x.id === e.target.value)!)}
        className="min-w-0 flex-1 sm:w-72 sm:flex-none"
      >
        {rounds.length > 1
          ? rounds.map((r) => (
              <optgroup key={r} label={`Round ${r}`}>
                {options(event.windows.filter((x) => x.round === r))}
              </optgroup>
            ))
          : options(event.windows)}
      </PillSelect>
      <button className={step} onClick={() => next && onPick(next)} disabled={!next} aria-label="Next session">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/**
 * The same event in other regions, by swapping the ID suffix. NAE has no events
 * of its own this season (D11), so it's offered only if a NAE copy turns up.
 */
function RegionSwitch({ event, w, here }: { event: EventInfo; w?: EventWindow; here: Region }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const visible = useEvents().data?.events ?? [];
  const regions = REGIONS.filter(
    (r) => r === here || r !== 'NAE' || visible.some((e) => e.id === inRegion(event.id, r)),
  );
  const go = (r: Region) => {
    const tab = params.get('tab');
    navigate(eventPath(inRegion(event.id, r)!, w && inRegion(w.id, r), tab ? `tab=${tab}` : ''), { replace: true });
  };
  return (
    <PillSelect
      aria-label="Event region"
      tone="onArt"
      icon={<GlobeIcon size={15} />}
      value={here}
      onChange={(e) => go(e.target.value as Region)}
    >
      {regions.map((r) => (
        <option key={r} value={r}>
          {r} · {REGION_LABEL[r]}
        </option>
      ))}
    </PillSelect>
  );
}

// --- Tabs ----------------------------------------------------------------------

function NotStarted({
  w,
  latest,
  onPick,
  now,
}: {
  w: EventWindow;
  latest?: EventWindow;
  onPick: (w: EventWindow) => void;
  now: Date;
}) {
  const [{ timeZone }] = useSettings();
  return (
    <Panel className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <ClockIcon size={28} className="text-accent-bright" />
      <div>
        <p className="font-display text-2xl font-bold tracking-wide uppercase">
          {w.label} starts <Countdown to={w.begin} now={now} />
        </p>
        <p className="mt-1 text-sm text-muted">{formatRange(w.begin, w.end, timeZone)}</p>
      </div>
      <p className="text-sm text-muted">The leaderboard opens when the session starts.</p>
      {latest && (
        <Button variant="secondary" size="sm" onClick={() => onPick(latest)}>
          See {latest.label} results
        </Button>
      )}
    </Panel>
  );
}

function SessionsTab({
  event,
  selected,
  onPick,
  now,
}: {
  event: EventInfo;
  selected?: EventWindow;
  onPick: (w: EventWindow) => void;
  now: Date;
}) {
  const [{ timeZone }] = useSettings();
  const rounds = [...new Set(event.windows.map((w) => w.round))].sort((a, b) => a - b);
  return (
    <div className="space-y-6">
      {rounds.map((round) => (
        <section key={round}>
          {rounds.length > 1 && <SectionHeader title={`Round ${round}`} />}
          <Panel className="overflow-hidden">
            <ul className="divide-y divide-line">
              {event.windows
                .filter((w) => w.round === round)
                .map((w) => {
                  const state = windowState(w, now);
                  const isSel = w.id === selected?.id;
                  return (
                    <li key={w.id}>
                      <button
                        onClick={() => onPick(w)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-raised/60 ${isSel ? 'bg-accent-soft' : ''}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-semibold">{w.label}</span>
                            <StageTag stage={w.stage} />
                          </span>
                          <span className="block text-xs text-muted">
                            {formatRange(w.begin, w.end, timeZone)}
                            {w.isTBD && ' · times to be confirmed'}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                          <StateTag state={state} />
                          {state === 'upcoming' && <Countdown to={w.begin} now={now} />}
                          {state === 'live' && <Countdown to={w.end} now={now} prefix="ends in" />}
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-faint" />
                      </button>
                    </li>
                  );
                })}
            </ul>
          </Panel>
        </section>
      ))}
      {finishedSessions(event.windows, now).length > 0 && (
        <section>
          <SectionHeader title="Cutoff history" />
          <CutoffHistory event={event} />
        </section>
      )}
    </div>
  );
}

function RulesTab({ event, w, detail }: { event: EventInfo; w?: EventWindow; detail: DetailQuery }) {
  const { boards, board, pick } = useBoardChoice(detail.data);
  const sameRules = event.windows.every((x) => x.requirements.join('|') === event.windows[0]!.requirements.join('|'));
  const rules = sameRules ? (event.windows[0]?.requirements ?? []) : (w?.requirements ?? []);
  return (
    <div>
      {event.description && <p className="max-w-prose text-sm leading-relaxed text-muted">{event.description}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Region', event.homeRegion === 'GLOBAL' ? 'Global' : REGION_LABEL[event.homeRegion]],
          ['Platforms', event.platforms.map((p) => PLATFORM_LABEL[p]).join(', ')],
          ['Account level', event.minAccountLevel ? `${event.minAccountLevel}+` : 'Any'],
          ['Sessions', String(event.windows.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface px-3 py-2">
            <dt className="text-[10px] font-semibold tracking-wider text-faint uppercase">{k}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      {rules.length > 0 && (
        <>
          <SectionHeader title={sameRules ? 'Entry rules' : `Entry rules · ${w?.label}`} />
          <ul className="space-y-1.5 text-sm">
            {rules.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="skew mt-1.5 h-2 w-2 shrink-0 bg-accent" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
        </>
      )}

      {w && (
        <>
          <SectionHeader title={`Scoring · ${w.label}`} />
          {detail.error ? (
            <ErrorNote error={detail.error} onRetry={detail.reload} />
          ) : !board ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="space-y-3">
              <BoardPicker boards={boards} board={board} onPick={pick} />
              <ScoringPanel board={board} />
              <SectionHeader title={`Prizes · ${board.label}`} />
              <PrizesPanel board={board} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BoardTab({ event, w, detail }: { event: EventInfo; w: EventWindow; detail: DetailQuery }) {
  const { boards, board, pick } = useBoardChoice(detail.data);
  if (detail.error && !board) return <ErrorNote error={detail.error} onRetry={detail.reload} />;
  if (!board) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-3">
      <BoardPicker boards={boards} board={board} onPick={pick} />
      <Leaderboard
        key={`${w.id}|${board.id}`}
        eventId={event.id}
        eventName={event.name}
        w={w}
        board={board}
        placementHistory={showsPlacement(event, w)}
      />
    </div>
  );
}

/** A set lobby's games (D28). A combined board has no lobbies, so it shows the session's own. */
function GamesTab({
  event,
  w,
  state,
  detail,
}: {
  event: EventInfo;
  w: EventWindow;
  state: WindowState;
  detail: DetailQuery;
}) {
  const { board: chosen } = useBoardChoice(detail.data);
  const board = chosen?.computed ? detail.data?.boards.find((b) => b.id === detail.data?.defaultBoard) : chosen;
  if (detail.error && !board) return <ErrorNote error={detail.error} onRetry={detail.reload} />;
  if (!board) return <Skeleton className="h-96" />;
  return <MatchesTab key={`${w.id}|${board.id}`} eventId={event.id} w={w} board={board} state={state} />;
}

// --- Page ----------------------------------------------------------------------

function EventView({ event, windowId }: { event: EventInfo; windowId?: string }) {
  const [{ timeZone }] = useSettings();
  const now = useNow(1000);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const latest = latestWindow(event.windows, now);
  const w = event.windows.find((x) => x.id === windowId) ?? latest;
  // Set lobbies (qualified rounds and finals) list their games; open sessions don't have lobbies to list.
  const hasGames = !!w && w.stage !== 'open';
  const asked = (['board', 'matches', 'sessions', 'rules'] as const).find((t) => t === params.get('tab'));
  const tab = asked === 'matches' && !hasGames ? 'board' : (asked ?? (w ? 'board' : 'sessions'));
  const state = w && windowState(w, now);
  // Rules and prizes still show before the first session starts, from the first session.
  const ruleWindow = w ?? event.windows[0];
  const detail = useApi<WindowDetail>(
    ruleWindow ? `/api/window?${new URLSearchParams({ event: event.id, window: ruleWindow.id })}` : null,
    30 * 60_000,
  );
  const multi = event.windows.length > 1;

  const pickSession = (x: EventWindow, toBoard = false) => {
    const t = toBoard ? 'board' : tab;
    navigate(eventPath(event.id, x.id, t === 'board' ? '' : `tab=${t}`), { replace: true });
  };
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.delete('match');
    if (t === 'board' && w) next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <Hero event={event} w={w} now={now} />

      {w && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          {multi && <SessionPicker event={event} w={w} onPick={pickSession} now={now} />}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {state && <StateTag state={state} />}
            <StageTag stage={w.stage} />
            {!multi && <span className="font-semibold text-ink">{w.label}</span>}
            <span>
              {formatDay(w.begin, timeZone)}, {formatTime(w.begin, timeZone)} – {formatTime(w.end, timeZone)}{' '}
              {zoneAbbrev(timeZone, w.begin)}
            </span>
            {state === 'live' && (
              <span>
                · ends <Countdown to={w.end} now={now} />
              </span>
            )}
          </p>
        </div>
      )}

      <div className="mt-5">
        <Tabs<Tab>
          label="Event sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'board', label: 'Leaderboard' },
            ...(hasGames ? [{ id: 'matches' as const, label: 'Matches' }] : []),
            { id: 'sessions', label: `Sessions${event.windows.length > 1 ? ` · ${event.windows.length}` : ''}` },
            { id: 'rules', label: 'Rules & prizes' },
          ]}
        />
      </div>

      <div className="mt-4">
        {tab === 'board' &&
          (!w ? (
            ruleWindow && <NotStarted w={ruleWindow} onPick={(x) => pickSession(x, true)} now={now} />
          ) : state === 'upcoming' ? (
            <NotStarted w={w} latest={latest} onPick={(x) => pickSession(x, true)} now={now} />
          ) : (
            <BoardTab event={event} w={w} detail={detail} />
          ))}
        {tab === 'matches' &&
          w &&
          state &&
          (state === 'upcoming' ? (
            <NotStarted w={w} latest={latest} onPick={(x) => pickSession(x, true)} now={now} />
          ) : (
            <GamesTab event={event} w={w} state={state} detail={detail} />
          ))}
        {tab === 'sessions' && (
          <SessionsTab event={event} selected={w} onPick={(x) => pickSession(x, true)} now={now} />
        )}
        {tab === 'rules' && <RulesTab event={event} w={ruleWindow} detail={detail} />}
      </div>
    </div>
  );
}

export default function EventPage() {
  const params = useParams();
  const eventId = params.eventId ?? '';
  const windowId = params.windowId;
  const navigate = useNavigate();
  const { event, loading, error, reload } = useEvent(eventId);
  const region = regionOf(eventId);
  if (event) return <EventView key={event.id} event={event} windowId={windowId} />;
  if (loading) return <HeroSkeleton />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return (
    <div className="py-10">
      <Empty
        action={
          <div className="flex justify-center gap-2">
            <Button size="sm" onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate('/events')}>
              All events
            </Button>
          </div>
        }
      >
        {region
          ? `This event isn't on the ${REGION_LABEL[region]} schedule this season.`
          : "This event isn't in this season's schedule."}
      </Empty>
    </div>
  );
}
