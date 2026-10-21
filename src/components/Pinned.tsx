// Pinned follows (F18): your follows' and saved teams' rows above the board,
// wherever they rank. Rows on loaded pages refresh with the board; the rest come
// from the last search of all pages, which a live board repeats every few minutes.
// Tapping a row jumps to it on the board.

import type { Entry } from '../../lib/types';
import type { PinnedRow } from '../board';
import { formatTime, ordinal, plural } from '../format';
import type { Move } from '../movement';
import type { Team } from '../teams';
import { fmtN, Rank } from './BoardRows';
import { ChevronRight, SearchIcon, StarIcon } from './icons';
import { Button, Chip, Panel } from './ui';

export interface SearchState {
  running: boolean;
  /** A repeat search of a live board, shown quietly. */
  quiet?: boolean;
  done?: number;
  total?: number;
  error?: string;
}

export function PinnedStrip({
  pinned,
  missing,
  rows,
  names,
  teams,
  moves,
  search,
  searchedAt,
  searchComplete,
  canSearch,
  totalPages,
  final,
  tz,
  onFind,
  onJump,
}: {
  pinned: PinnedRow[];
  /** IDs on neither the loaded pages nor the last search. */
  missing: string[];
  /** Loaded rows, for teammates' names. */
  rows: Entry[];
  /** Follows' names by account ID. */
  names: Map<string, string>;
  teams: Team[];
  moves: Map<string, Move>;
  search: SearchState;
  searchedAt?: string;
  /** The last search read every page. */
  searchComplete: boolean;
  canSearch: boolean;
  totalPages: number;
  /** Final standings don't change, so search results need no time. */
  final: boolean;
  tz: string;
  onFind: () => void;
  onJump: (rank: number, teamKey: string) => void;
}) {
  const nameOf = (id: string) =>
    names.get(id) ??
    rows.flatMap((r) => r.members).find((m) => m.id === id && m.name)?.name ??
    teams.flatMap((t) => t.members).find((m) => m.id === id)?.name ??
    `${id.slice(0, 6)}…`;
  // Name a saved team once rather than each of its players.
  const missingLabels = [
    ...teams.filter((t) => t.members.every((m) => missing.includes(m.id))).map((t) => t.name),
    ...missing.filter((id) => names.has(id)).map((id) => names.get(id)!),
  ];
  const where = totalPages >= 100 ? 'in the top 10,000' : 'on this board';
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 pt-2.5 pb-1.5">
        <h3 className="font-display text-sm font-bold tracking-wider text-muted uppercase">
          Pinned{pinned.length ? ` · ${pinned.length}` : ''}
        </h3>
        {canSearch && (search.running ? !search.quiet : missing.length > 0 && !searchComplete) && (
          <Button size="sm" variant="ghost" onClick={onFind} disabled={search.running}>
            <SearchIcon size={14} />
            {search.running ? `Searching ${search.done ?? 0}/${search.total ?? '…'}` : 'Find on all pages'}
          </Button>
        )}
      </div>
      {search.running && !search.quiet && search.total ? (
        <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${((search.done ?? 0) / search.total) * 100}%` }}
          />
        </div>
      ) : null}
      {pinned.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {pinned.map((p) => {
            const team = teams.find((t) => t.key === p.teamKey);
            return (
              <li key={p.teamKey}>
                <button
                  onClick={() => onJump(p.rank, p.teamKey)}
                  className="grid min-h-11 w-full grid-cols-[2.75rem_minmax(0,1fr)_auto_1rem] items-center gap-x-2 px-3 py-1.5 text-left text-sm transition hover:bg-raised/60 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto_1rem]"
                  aria-label={`Show ${ordinal(p.rank)} on the board`}
                >
                  <Rank rank={p.rank} move={p.source === 'board' ? moves.get(p.teamKey) : undefined} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {team && <Chip tone="accent">{team.name}</Chip>}
                      <span className="block min-w-0 flex-1 truncate">
                        {p.memberIds.map((id, i) => (
                          <span key={id}>
                            {i > 0 && <span className="px-1 text-faint">/</span>}
                            <span className={names.has(id) ? 'font-semibold' : 'text-muted'}>
                              {names.has(id) && (
                                <StarIcon size={11} className="mr-0.5 inline fill-accent text-accent" />
                              )}
                              {nameOf(id)}
                            </span>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="nums block truncate text-[11px] text-faint">
                      {plural(p.matches, 'game')} · {plural(p.victories, 'win')} · {plural(p.elims, 'elim')}
                      {p.source === 'search' && !final && searchedAt && ` · as of ${formatTime(searchedAt, tz)}`}
                    </span>
                  </span>
                  <span className="nums text-right font-bold">{fmtN(p.points)}</span>
                  <ChevronRight size={15} className="text-faint" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {missingLabels.length > 0 && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          {searchComplete ? `Not ${where}: ` : canSearch ? 'Not on the loaded pages: ' : 'Not here: '}
          <span className="text-ink">{missingLabels.join(', ')}</span>
        </p>
      )}
      {search.running && search.quiet && (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">Updating pinned rows…</p>
      )}
      {search.error && <p className="border-t border-line px-3 py-2 text-xs text-live">{search.error}</p>}
    </Panel>
  );
}
