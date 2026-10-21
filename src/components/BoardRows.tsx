// Leaderboard rows: rank with its movement arrow (F15), names with a saved
// team's label (F24), stats, and a breakdown that opens on tap with each game
// (F17, each one opening that game, D28), points per game or, in qualified
// rounds and finals, placement after each game (D29), and buttons to follow the
// players or save them as a team. Cutoff lines (F16) and gaps between loaded
// pages sit between rows.

import { memo, useContext, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Entry } from '../../lib/types';
import { cutoffTitle, type PlacedCutoff } from '../board';
import { addFollow, useFollows } from '../follows';
import { ordinal, plural } from '../format';
import type { Move } from '../movement';
import { PlacementContext, type Placements } from '../placements';
import { removeTeam, saveTeam, useTeams } from '../teams';
import { LineChart, MatchChart } from './Charts';
import { GamesTable } from './MatchView';
import { MoveIcon, PlusIcon, StarIcon } from './icons';
import { Button, Chip } from './ui';

export const fmtN = (n: number) => n.toLocaleString('en-US');

const RANK_TONE: Record<number, string> = { 1: 'text-gold', 2: 'text-silver', 3: 'text-bronze' };
export const COLS =
  'grid grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:grid-cols-[3.25rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem_3.75rem_4.5rem]';

export function MoveTag({ move }: { move?: Move }) {
  if (move === undefined) return null;
  if (move === 'new')
    return <span className="text-[9px] leading-none font-bold tracking-wider text-accent-bright uppercase">New</span>;
  const up = move > 0;
  return (
    <span
      className={`nums inline-flex items-center gap-0.5 text-[10px] leading-none font-bold ${up ? 'text-ok' : 'text-live'}`}
      aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(move)}`}
    >
      <MoveIcon down={!up} />
      {fmtN(Math.abs(move))}
    </span>
  );
}

export function Rank({ rank, move }: { rank: number; move?: Move }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={`nums font-display text-lg leading-none font-bold ${RANK_TONE[rank] ?? 'text-muted'}`}>
        {fmtN(rank)}
      </span>
      <MoveTag move={move} />
    </span>
  );
}

function Names({ e }: { e: Entry }) {
  return (
    <span className="block truncate font-semibold">
      {e.members.map((m, i) => (
        <span key={m.id}>
          {i > 0 && <span className="px-1 font-normal text-faint">/</span>}
          {m.name ?? `${m.id.slice(0, 6)}…`}
        </span>
      ))}
    </span>
  );
}

/** Follow the players on a row, or save them as a team. */
function Members({ e }: { e: Entry }) {
  const follows = useFollows();
  const teams = useTeams();
  const saved = teams.find((t) => t.key === e.teamKey);
  const [naming, setNaming] = useState<string>();
  const members = e.members.map((m) => ({ id: m.id, name: m.name ?? `${m.id.slice(0, 6)}…` }));
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (naming?.trim()) saveTeam(naming, members);
    setNaming(undefined);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {members.map((m) => {
        const following = follows.some((f) => f.id === m.id);
        return (
          <span
            key={m.id}
            className={`inline-flex h-7 max-w-[12rem] items-center rounded-md border text-xs font-semibold ${following ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface'}`}
          >
            <button
              onClick={() => addFollow(m.id, m.name)}
              disabled={following}
              aria-label={following ? `Following ${m.name}` : `Follow ${m.name}`}
              className="grid h-full w-7 shrink-0 place-items-center disabled:cursor-default"
            >
              {following ? (
                <StarIcon size={12} className="fill-accent text-accent" />
              ) : (
                <PlusIcon size={12} className="text-accent-bright" />
              )}
            </button>
            <Link to={`/players/${m.id}`} className="truncate pr-2 hover:underline">
              {m.name}
            </Link>
          </span>
        );
      })}
      {members.length > 1 &&
        (saved ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            Team <Chip tone="accent">{saved.name}</Chip>
            <button onClick={() => removeTeam(saved.key)} className="font-semibold text-accent-bright hover:underline">
              Remove
            </button>
          </span>
        ) : naming === undefined ? (
          <Button size="sm" variant="ghost" onClick={() => setNaming(members.map((m) => m.name).join(' / '))}>
            Save as team
          </Button>
        ) : (
          <form onSubmit={save} className="flex items-center gap-1.5">
            <input
              value={naming}
              onChange={(ev) => setNaming(ev.target.value)}
              maxLength={32}
              autoFocus
              aria-label="Team name"
              className="h-8 w-40 rounded-md border border-line bg-surface px-2 text-xs outline-none focus:border-accent"
            />
            <Button size="sm" variant="primary" type="submit">
              Save
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setNaming(undefined)}>
              Cancel
            </Button>
          </form>
        ))}
    </div>
  );
}

/** Where the team stood after each game (D29), while the board is read and once it is. */
function PlacementChart({ placements, ranks, e }: { placements: Placements; ranks?: number[]; e: Entry }) {
  if (!ranks)
    return (
      <figure>
        <figcaption className="text-[10px] font-semibold tracking-wider text-faint uppercase">
          Placement after each game
        </figcaption>
        <div className="mt-1 grid h-36 place-items-center rounded-md border border-dashed border-line px-3 text-center text-xs text-muted">
          <span>
            Reading the board to work out placements
            {placements.total > 1 && `: ${placements.done} of ${placements.total} pages`}…
          </span>
        </div>
      </figure>
    );
  return (
    <LineChart
      title={`Placement after each game${placements.teams ? ` · of ${fmtN(placements.teams)}` : ''}`}
      ranks
      format={ordinal}
      xLabels={ranks.map((_, i) => String(i + 1))}
      points={ranks.map((r, i) => {
        const s = e.sessions[i]!;
        return {
          value: r,
          label: `after game ${i + 1} · ${s.victory ? 'win' : s.place ? `#${s.place}` : '—'} · ${s.points ?? 0} pts`,
        };
      })}
    />
  );
}

function Games({ e, tz, onMatch }: { e: Entry; tz: string; onMatch: (sessionId: string) => void }) {
  const placements = useContext(PlacementContext);
  const points = e.sessions.map((s) => s.points);
  const byPlacement = !!placements?.enabled && e.sessions.length > 0 && points.every((p) => p !== null);
  const ensure = placements?.ensure;
  useEffect(() => {
    if (byPlacement) ensure?.();
  }, [byPlacement, ensure]);
  const ranks = byPlacement ? placements.after?.(points as number[]) : undefined;
  return (
    <div className="space-y-2.5 border-t border-line bg-bg/60 px-3 py-2.5 sm:pl-[3.25rem]">
      <Members e={e} />
      {e.sessions.length > 1 && (
        <div className="max-w-md">
          {byPlacement && !placements.error ? (
            <PlacementChart placements={placements} ranks={ranks} e={e} />
          ) : (
            <MatchChart sessions={e.sessions} tz={tz} />
          )}
        </div>
      )}
      {byPlacement && placements.error && (
        <p className="text-xs text-muted">
          Couldn't work out placements: {placements.error}{' '}
          <button
            onClick={() => placements.ensure(true)}
            className="font-semibold text-accent-bright underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      )}
      {e.sessions.length > 0 && <GamesTable sessions={e.sessions} tz={tz} onGame={onMatch} ranks={ranks} />}
    </div>
  );
}

export const Row = memo(function Row({
  e,
  move,
  team,
  followed,
  open,
  flash,
  lines,
  onToggle,
  onMatch,
  tz,
}: {
  e: Entry;
  move?: Move;
  /** Saved team name for this row. */
  team?: string;
  followed: boolean;
  open: boolean;
  flash: boolean;
  /** Cutoff lines that fall right after this row. */
  lines?: PlacedCutoff[];
  onToggle: (teamKey: string) => void;
  /** Opens one of the team's games. */
  onMatch: (sessionId: string) => void;
  tz: string;
}) {
  const marked = followed || !!team;
  return (
    <li
      data-rank={e.rank}
      data-team={e.teamKey}
      className={`relative ${marked ? 'bg-accent-soft' : ''} ${flash ? 'row-flash' : ''}`}
    >
      {marked && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden />}
      <button
        onClick={() => onToggle(e.teamKey)}
        aria-expanded={open}
        className={`${COLS} min-h-11 w-full items-center gap-x-2 px-3 py-1.5 text-left text-sm transition hover:bg-raised/60`}
      >
        <Rank rank={e.rank} move={move} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            {followed && <StarIcon size={13} className="shrink-0 fill-accent text-accent" />}
            {team && <Chip tone="accent">{team}</Chip>}
            <span className="min-w-0 flex-1">
              <Names e={e} />
            </span>
          </span>
          <span className="nums block text-[11px] text-faint sm:hidden">
            {plural(e.matches, 'game')} · {plural(e.victories, 'win')} · {plural(e.elims, 'elim')}
          </span>
        </span>
        <span className="nums hidden text-right text-muted sm:block">{e.matches}</span>
        <span className="nums hidden text-right text-muted sm:block">{e.victories}</span>
        <span className="nums hidden text-right text-muted sm:block">{e.elims}</span>
        <span className="nums hidden text-right text-muted sm:block">{e.avgPlace ?? '—'}</span>
        <span className="nums text-right font-bold">{fmtN(e.points)}</span>
      </button>
      {open && <Games e={e} tz={tz} onMatch={onMatch} />}
      {lines?.map((l) => (
        <CutoffLine key={`${l.kind}|${l.basis}|${l.threshold}`} line={l} />
      ))}
    </li>
  );
});

export function HeaderRow() {
  return (
    <div
      className={`${COLS} gap-x-2 border-b border-line px-3 py-2 text-[10px] font-semibold tracking-wider text-faint uppercase`}
    >
      <span>#</span>
      <span>Player</span>
      <span className="hidden text-right sm:block">Games</span>
      <span className="hidden text-right sm:block">Wins</span>
      <span className="hidden text-right sm:block">Elims</span>
      <span className="hidden text-right sm:block">Avg</span>
      <span className="text-right">Points</span>
    </div>
  );
}

const LINE_TONE: Record<PlacedCutoff['kind'], string> = {
  qualify: 'border-accent text-accent-bright bg-accent-soft',
  cash: 'border-ok text-ok bg-ok/10',
  skin: 'border-gold text-gold bg-gold/10',
  item: 'border-line-strong text-muted',
};

function CutoffLine({ line }: { line: PlacedCutoff }) {
  return (
    <div
      role="separator"
      className={`flex items-center gap-2 border-t-2 border-dashed px-3 py-1 text-[11px] font-bold tracking-wider uppercase ${LINE_TONE[line.kind]}`}
    >
      <span className="nums shrink-0">
        {line.approx && '≈ '}
        {cutoffTitle(line)}
      </span>
      <span className="truncate font-semibold tracking-normal normal-case">{line.label}</span>
    </div>
  );
}

/** Ranks between two loaded runs, with a button to load the page on either side. */
export function GapRow({
  fromPage,
  toPage,
  pending,
  onLoad,
}: {
  /** First and last page not loaded. */
  fromPage: number;
  toPage: number;
  pending: number[];
  onLoad: (page: number) => void;
}) {
  const ranks = (p: number) => `${fmtN(p * 100 + 1)}–${fmtN((p + 1) * 100)}`;
  const pages = fromPage === toPage ? [fromPage] : [fromPage, toPage];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 bg-bg/60 px-3 py-2 text-xs text-muted">
      <span className="nums">
        Ranks {fmtN(fromPage * 100 + 1)}–{fmtN((toPage + 1) * 100)} not loaded
      </span>
      <span className="flex gap-1.5">
        {pages.map((p) => (
          <Button key={p} size="sm" variant="ghost" onClick={() => onLoad(p)} disabled={pending.includes(p)}>
            {pending.includes(p) ? 'Loading…' : `Show ${ranks(p)}`}
          </Button>
        ))}
      </span>
    </div>
  );
}
