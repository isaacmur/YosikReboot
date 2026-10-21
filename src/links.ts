// Event URLs and the region suffix on Epic's event and session IDs
// (`epicgames_S42_PurgeCup_EU`, `S42_PurgeCup_Event2_EU`).

import { isRegion, REGIONS, type Region } from '../lib/types';

const SUFFIX = new RegExp(`_(${REGIONS.join('|')})$`);

/** Region from an ID's suffix; undefined for global events. */
export function regionOf(id: string): Region | undefined {
  const r = SUFFIX.exec(id)?.[1];
  return isRegion(r) ? r : undefined;
}

/** The same event or session in another region (same ID, other suffix); undefined for global events. */
export function inRegion(id: string, region: Region): string | undefined {
  return regionOf(id) ? id.replace(SUFFIX, `_${region}`) : undefined;
}

export function eventPath(eventId: string, windowId?: string, search?: string): string {
  const path = `/events/${encodeURIComponent(eventId)}${windowId ? `/${encodeURIComponent(windowId)}` : ''}`;
  return search ? `${path}?${search}` : path;
}
