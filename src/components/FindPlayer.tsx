// Finding anyone on a board by name (D26): Epic turns the exact display name into
// an account ID, then the board's pages are read a few at a time (reusing any
// already read this visit) until that player turns up, and the board jumps there.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Entry, PlayerLookup } from '../../lib/types';
import { apiGetCached } from '../api';
import { addFollow, useFollows } from '../follows';
import { searchBoard, type FoundRow } from '../scan';
import { teamKeyOf } from '../teams';
import { fmtN } from './BoardRows';
import { StarIcon, XIcon } from './icons';
import { Button } from './ui';

export interface Hunt {
  name: string;
  status: 'looking' | 'reading' | 'found' | 'missing' | 'error';
  player?: PlayerLookup;
  row?: FoundRow;
  done?: number;
  total?: number;
  message?: string;
}

export function useFindPlayer(o: {
  eventId: string;
  windowId: string;
  board: string;
  final: boolean;
  /** Rows on the loaded pages, checked before reading anything. */
  entries: Entry[];
  /** Where the player was last found on this board, to read first. */
  hint: (id: string) => number | undefined;
  jumpTo: (rank: number, teamKey?: string) => Promise<void>;
}) {
  const [hunt, setHunt] = useState<Hunt>();
  const ctl = useRef<AbortController>(undefined);
  const latest = useRef(o);
  latest.current = o;
  useEffect(() => () => ctl.current?.abort(), []);

  const find = useCallback(async (raw: string) => {
    const name = raw.trim();
    const { eventId, windowId, board, final, entries, hint, jumpTo } = latest.current;
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setHunt({ name, status: 'looking' });
    try {
      const player = await apiGetCached<PlayerLookup>(`/api/player?${new URLSearchParams({ name })}`, 3_600_000);
      if (mine.signal.aborted) return;
      const here = entries.find((e) => e.members.some((m) => m.id === player.id));
      if (here) {
        setHunt({ name, status: 'found', player });
        await jumpTo(here.rank, here.teamKey);
        return;
      }
      setHunt({ name, status: 'reading', player });
      const last = hint(player.id);
      const result = await searchBoard(eventId, windowId, board, [player.id], {
        final,
        signal: mine.signal,
        hints: last === undefined ? [] : [last],
        onProgress: (done, total) => !mine.signal.aborted && setHunt((h) => h && { ...h, done, total }),
      });
      const row = result.found[player.id];
      setHunt({ name, status: row ? 'found' : 'missing', player, row, total: result.totalPages });
      if (row) await jumpTo(row.rank, teamKeyOf(row.memberIds));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setHunt({ name, status: 'error', message: (err as Error).message });
    }
  }, []);

  const stop = useCallback(() => {
    ctl.current?.abort();
    setHunt(undefined);
  }, []);

  return { hunt, find, stop };
}

export function HuntNote({ hunt, onStop }: { hunt: Hunt; onStop: () => void }) {
  const follows = useFollows();
  const p = hunt.player;
  const followed = !!p && follows.some((f) => f.id === p.id);
  const busy = hunt.status === 'looking' || hunt.status === 'reading';
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted"
    >
      <span className="min-w-0 flex-1">
        {hunt.status === 'looking' && <>Looking up “{hunt.name}”…</>}
        {hunt.status === 'reading' && (
          <>
            Finding <b className="text-ink">{p?.displayName}</b>
            {hunt.total ? ` · ${hunt.done ?? 0} of ${hunt.total} pages read` : '…'}
          </>
        )}
        {hunt.status === 'found' && p && (
          <>
            <Link to={`/players/${p.id}`} className="font-semibold text-ink hover:underline">
              {p.displayName}
            </Link>
            {hunt.row ? ` is #${fmtN(hunt.row.rank)} with ${fmtN(hunt.row.points)} points.` : ' is on the board below.'}
          </>
        )}
        {hunt.status === 'missing' && p && (
          <>
            <b className="text-ink">{p.displayName}</b> isn't on this board
            {hunt.total && hunt.total >= 100 ? ' in the top 10,000' : ''}.
          </>
        )}
        {hunt.status === 'error' && (
          <>
            Couldn't find “{hunt.name}”: {hunt.message}
          </>
        )}
      </span>
      {hunt.status === 'reading' && hunt.total ? (
        <span className="h-1 w-24 overflow-hidden rounded-full bg-raised" aria-hidden>
          <span
            className="block h-full bg-accent transition-all"
            style={{ width: `${((hunt.done ?? 0) / hunt.total) * 100}%` }}
          />
        </span>
      ) : null}
      {p && !followed && !busy && (
        <Button size="sm" variant="ghost" onClick={() => addFollow(p.id, p.displayName)}>
          <StarIcon size={13} /> Follow
        </Button>
      )}
      {busy ? (
        <Button size="sm" onClick={onStop}>
          Stop
        </Button>
      ) : (
        <button onClick={onStop} aria-label="Dismiss" className="text-faint hover:text-ink">
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}
