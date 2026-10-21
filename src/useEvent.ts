import { isRegion, REGIONS, type EventInfo, type Region } from '../lib/types';
import { useSettings } from './settings';
import { useEvents } from './useEvents';

/** Region from the ID suffix, used when the event isn't visible in the selected region. */
function suffixRegion(id: string): Region | undefined {
  const r = new RegExp(`_(${REGIONS.join('|')})$`).exec(id)?.[1];
  return isRegion(r) ? r : undefined;
}

/** One event from this season's schedule: the selected region first, then its own. */
export function useEvent(eventId: string): { event?: EventInfo; loading: boolean; error?: Error; reload: () => void } {
  const [{ region }] = useSettings();
  const here = useEvents();
  const home = suffixRegion(eventId);
  const fallback = useEvents(home && home !== region ? home : region);
  const event = here.data?.events.find((e) => e.id === eventId) ?? fallback.data?.events.find((e) => e.id === eventId);
  return { event, loading: here.loading || fallback.loading, error: here.error, reload: here.reload };
}
