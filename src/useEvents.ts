import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { REGIONS, type EventInfo, type EventsResponse, type Region } from '../lib/types';
import { apiGetCached, AuthError, useApi } from './api';
import { useSettings } from './settings';

const SCHEDULE_MAX_AGE_MS = 5 * 60_000;

/** The schedule for a region (default: the one in settings). The server caches it 15 min; we reuse ours for 5. */
export function useEvents(region?: Region) {
  const [settings] = useSettings();
  return useApi<EventsResponse>(`/api/events?region=${region ?? settings.region}`, SCHEDULE_MAX_AGE_MS);
}

/** Every region's events, each once (regions overlap, D11): first seen in REGIONS order wins. */
export function mergeRegions(lists: EventsResponse[]): EventInfo[] {
  const byId = new Map<string, EventInfo>();
  for (const l of lists) for (const e of l.events) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

/**
 * All eight regions' schedules, for search and the all-regions calendar. Fetched
 * only while `enabled`: eight CDN-cached calls, one per region (D22).
 */
export function useAllEvents(enabled: boolean): { events: EventInfo[]; loading: boolean; error?: Error } {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef('');
  here.current = location.pathname + location.search;
  const [state, setState] = useState<{ events: EventInfo[]; loading: boolean; error?: Error }>({
    events: [],
    loading: enabled,
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void Promise.allSettled(
      REGIONS.map((r) => apiGetCached<EventsResponse>(`/api/events?region=${r}`, SCHEDULE_MAX_AGE_MS)),
    ).then((results) => {
      if (cancelled) return;
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed?.reason instanceof AuthError) {
        navigate('/login', { replace: true, state: { from: here.current } });
        return;
      }
      const lists = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      setState({ events: mergeRegions(lists), loading: false, error: failed?.reason as Error | undefined });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, navigate]);
  return state;
}
