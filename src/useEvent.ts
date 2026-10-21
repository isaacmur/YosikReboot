import type { EventInfo } from '../lib/types';
import { regionOf } from './links';
import { useSettings } from './settings';
import { useEvents } from './useEvents';

/** One event from this season's schedule: the selected region first, then its own. */
export function useEvent(eventId: string): { event?: EventInfo; loading: boolean; error?: Error; reload: () => void } {
  const [{ region }] = useSettings();
  const here = useEvents();
  const home = regionOf(eventId);
  const fallback = useEvents(home && home !== region ? home : region);
  const event = here.data?.events.find((e) => e.id === eventId) ?? fallback.data?.events.find((e) => e.id === eventId);
  const error = here.error ?? fallback.error;
  return { event, loading: here.loading || fallback.loading, error, reload: here.reload };
}
