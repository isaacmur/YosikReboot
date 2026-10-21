// Live polling for leaderboards (F11): every `refreshSec` while a session is live,
// every 5 min while it wraps up, not at all once final. Pauses while the tab is
// hidden (phone locked), fetches at once on return, and backs off 2 then 4 min on
// errors, reporting since when the data is stale.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { refreshMsFor } from '../lib/status';
import type { WindowState } from '../lib/types';
import { apiGet, AuthError } from './api';

const BACKOFF_MS = [2 * 60_000, 4 * 60_000];

export interface LiveQuery<T> {
  data?: T;
  error?: Error;
  loading: boolean;
  /** When the shown data was received. */
  receivedAt?: Date;
  /** Set while refreshes are failing: the time of the first failure. */
  staleSince?: Date;
  /** Next scheduled refresh, if any. */
  nextAt?: Date;
  refresh: () => void;
}

export function useLiveQuery<T>(path: string | null, state: WindowState | undefined, liveMs: number): LiveQuery<T> {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef('');
  here.current = location.pathname + location.search;
  const [s, setS] = useState<Omit<LiveQuery<T>, 'refresh'>>({ loading: path !== null });
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Every fetch gets a number; only the latest one may update state. */
  const seq = useRef(0);
  const shownPath = useRef<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const schedule = useCallback((ms: number | null) => {
    clearTimeout(timer.current);
    if (ms === null || document.hidden) {
      setS((p) => ({ ...p, nextAt: undefined }));
      return;
    }
    setS((p) => ({ ...p, nextAt: new Date(Date.now() + ms) }));
    timer.current = setTimeout(() => void runRef.current(), ms);
  }, []);

  const run = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    const mine = ++seq.current;
    setS((prev) => ({ ...prev, loading: true }));
    try {
      const data = await apiGet<T>(p);
      if (mine !== seq.current) return;
      failures.current = 0;
      setS({ data, loading: false, receivedAt: new Date() });
      schedule(state ? refreshMsFor(state, liveMs) : null);
    } catch (err) {
      if (mine !== seq.current) return;
      if (err instanceof AuthError) {
        navigate('/login', { replace: true, state: { from: here.current } });
        return;
      }
      failures.current += 1;
      setS((prev) => ({ ...prev, error: err as Error, loading: false, staleSince: prev.staleSince ?? new Date() }));
      const polling = state ? refreshMsFor(state, liveMs) !== null : false;
      schedule(polling ? BACKOFF_MS[Math.min(failures.current, BACKOFF_MS.length) - 1]! : null);
    }
  }, [state, liveMs, navigate, schedule]);

  const runRef = useRef(run);
  runRef.current = run;

  // Fetch on mount and whenever the path or refresh rule changes.
  useEffect(() => {
    if (!path) return;
    failures.current = 0;
    // A different board: drop the old rows rather than show them under the new tab.
    if (shownPath.current !== path) {
      shownPath.current = path;
      setS({ loading: true });
    }
    void runRef.current();
    return () => clearTimeout(timer.current);
  }, [path, state, liveMs]);

  // Pause while hidden; refresh at once when visible again (if this board polls).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer.current);
        setS((p) => ({ ...p, nextAt: undefined }));
      } else if (state && refreshMsFor(state, liveMs) !== null) {
        void runRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [state, liveMs]);

  return { ...s, refresh: () => void runRef.current() };
}
