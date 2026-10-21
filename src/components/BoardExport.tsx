// CSV export of a board (F31): the rows loaded so far, or, once a session is
// final, every page (read one at a time, reusing pages already loaded).

import { useRef, useState } from 'react';
import type { Entry, LeaderboardPage } from '../../lib/types';
import { ApiError, apiGet } from '../api';
import { boardRows } from '../board';
import { boardCsv, fileName, saveFile } from '../csv';
import { plural } from '../format';
import { fmtN } from './BoardRows';
import { DownloadIcon } from './icons';
import { Button } from './ui';

export function BoardExport({
  rows,
  pages,
  query,
  totalPages,
  final,
  name,
  teamName,
}: {
  rows: Entry[];
  pages: Record<number, LeaderboardPage>;
  /** The board's query string, without `page`. */
  query: string;
  totalPages: number;
  final: boolean;
  /** Parts of the file name: event, session, board. */
  name: string[];
  teamName: (teamKey: string) => string | undefined;
}) {
  const [progress, setProgress] = useState<{ done: number; error?: string }>();
  const cancel = useRef<AbortController>(undefined);

  async function exportAll() {
    const ctl = (cancel.current = new AbortController());
    const all: Record<number, LeaderboardPage> = { ...pages };
    setProgress({ done: 0 });
    try {
      for (let p = 0; p < totalPages; p++) {
        if (ctl.signal.aborted) return;
        if (!all[p]) {
          const url = `/api/leaderboard?${query}&page=${p}`;
          try {
            all[p] = await apiGet<LeaderboardPage>(url);
          } catch (err) {
            // Rate limited or Epic hiccup: wait once, then try the page again.
            if (!(err instanceof ApiError) || err.status < 500) throw err;
            await new Promise((r) => setTimeout(r, 3000));
            all[p] = await apiGet<LeaderboardPage>(url);
          }
        }
        setProgress({ done: p + 1 });
      }
      saveFile(
        fileName([...name, 'all']),
        boardCsv(
          boardRows(all).map((r) => r.entry),
          teamName,
        ),
      );
      setProgress(undefined);
    } catch (err) {
      setProgress((s) => ({ done: s?.done ?? 0, error: (err as Error).message }));
    }
  }

  const running = progress !== undefined && !progress.error;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Loaded rows</p>
          <p className="text-xs text-muted">{plural(rows.length, 'team')} as shown now</p>
        </div>
        <Button onClick={() => saveFile(fileName(name), boardCsv(rows, teamName))} disabled={!rows.length}>
          <DownloadIcon size={14} /> CSV
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="font-semibold">Every page</p>
          <p className="text-xs text-muted">
            {final
              ? `${plural(totalPages, 'page')}, up to ${fmtN(totalPages * 100)} teams`
              : 'Once the session is final: live standings move while pages download.'}
          </p>
        </div>
        {running ? (
          <Button
            onClick={() => {
              cancel.current?.abort();
              setProgress(undefined);
            }}
          >
            Stop
          </Button>
        ) : (
          <Button onClick={() => void exportAll()} disabled={!final || totalPages < 1}>
            <DownloadIcon size={14} /> CSV
          </Button>
        )}
      </div>
      {progress && (
        <div role="status" className="text-xs text-muted">
          {progress.error ? (
            <span className="text-live">Stopped: {progress.error}</span>
          ) : (
            <>
              Page {progress.done} of {totalPages}
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(progress.done / totalPages) * 100}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
