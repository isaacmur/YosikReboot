// Sync with Epic (D30) on Me: sign in on epicgames.com with your own account,
// and every session Epic lists you in lands in your results. The sign-in is used
// for the sync only, then ended.

import { useEffect, useRef, useState } from 'react';
import { formatDay, formatTime, plural, useNow } from '../format';
import { useSettings } from '../settings';
import { endSync, syncWithEpic, useLastSync, type SyncProgress } from '../sync';
import { Button, Countdown, ExternalButton, Panel } from './ui';

export function SyncPanel({ intro }: { intro?: boolean }) {
  const [{ region, timeZone }] = useSettings();
  const last = useLastSync();
  const [progress, setProgress] = useState<SyncProgress>();
  const [error, setError] = useState<string>();
  const ctl = useRef<AbortController>(undefined);
  const now = useNow(1000);
  const running = !!progress;

  // Leaving the page mid-sync still ends the Epic session.
  useEffect(() => {
    if (!running) return;
    const onHide = () => void endSync();
    addEventListener('pagehide', onHide);
    return () => removeEventListener('pagehide', onHide);
  }, [running]);
  useEffect(() => () => ctl.current?.abort(), []);

  async function run() {
    ctl.current = new AbortController();
    setError(undefined);
    try {
      await syncWithEpic({ region, signal: ctl.current.signal, onProgress: setProgress });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message || 'The sync failed.');
    } finally {
      setProgress(undefined);
    }
  }

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-none font-bold tracking-wide uppercase">Sync with Epic</h2>
          <p className="mt-1.5 max-w-prose text-xs text-muted">
            {intro
              ? 'Sign in with your own Epic account to fill this page with every session you played this season. '
              : 'Pull in every session you played this season. '}
            You approve on epicgames.com; the sign-in is used for this sync only, then ended, and nothing is stored.
          </p>
        </div>
        {!running && (
          <Button variant={intro || !last ? 'primary' : 'secondary'} size="sm" onClick={() => void run()}>
            {last ? 'Sync again' : 'Sync with Epic'}
          </Button>
        )}
      </div>

      {progress?.step === 'starting' && <p className="text-sm text-muted">Asking Epic for a sign-in link…</p>}

      {progress?.step === 'approve' && progress.url && (
        <div className="space-y-3 rounded-md border border-line bg-bg/60 p-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Open Epic and sign in as yourself.</li>
            <li>
              Check the code matches <span className="nums font-display text-lg font-bold">{progress.code}</span>, then
              approve.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <ExternalButton href={progress.url} variant="primary">
              Open Epic
            </ExternalButton>
            <Button size="sm" variant="ghost" onClick={() => ctl.current?.abort()}>
              Cancel
            </Button>
          </div>
          <p role="status" className="text-xs text-muted">
            Waiting for you to approve
            {progress.expiresAt && (
              <>
                {' '}
                · link expires <Countdown to={progress.expiresAt} now={now} />
              </>
            )}
          </p>
        </div>
      )}

      {progress?.step === 'reading' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span role="status">
              Signed in as <b>{progress.displayName}</b>. Reading your sessions
              {progress.total ? `: ${progress.done} of ${progress.total}` : '…'}
            </span>
            <Button size="sm" onClick={() => ctl.current?.abort()}>
              Stop
            </Button>
          </div>
          {progress.total ? (
            <div className="h-1 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${((progress.done ?? 0) / progress.total) * 100}%` }}
              />
            </div>
          ) : null}
        </div>
      )}

      {error && <p className="text-xs text-live">Stopped: {error}</p>}

      {!running && last && (
        <p className="text-xs text-muted">
          Last synced {formatDay(last.at, timeZone)}, {formatTime(last.at, timeZone)} as{' '}
          <b className="text-ink">{last.displayName}</b>: {plural(last.found, 'result')} from{' '}
          {plural(last.sessions, 'session')}
          {last.fromEpicList ? '' : ' (Epic listed none, so your latest sessions were tried)'}. Signed out of Epic.
        </p>
      )}
    </Panel>
  );
}
