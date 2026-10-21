import type { EventsResponse, Region } from '../lib/types';
import { useApi } from './api';
import { useSettings } from './settings';

/** The schedule for a region (default: the one in settings). The server caches it 15 min; we reuse ours for 5. */
export function useEvents(region?: Region) {
  const [settings] = useSettings();
  return useApi<EventsResponse>(`/api/events?region=${region ?? settings.region}`, 5 * 60_000);
}
