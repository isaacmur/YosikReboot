// Raw schedule documents (events/download) kept per warm instance, so the
// leaderboard and window routes can look up window times and scoring without
// another Epic call. Same 15-minute lifetime as the CDN copy of /api/events.

import { isRegion, REGIONS, type Region } from '../types.js';
import type { EpicClient } from './client.js';
import { endpoints } from './endpoints.js';
import { asArr, asObj, str } from './json.js';

export const SCHEDULE_TTL_MS = 15 * 60_000;

const cache = new Map<Region, { at: number; raw: unknown; pending?: Promise<unknown> }>();

export async function rawSchedule(client: EpicClient, accountId: string, region: Region, now = Date.now()) {
  const hit = cache.get(region);
  if (hit && now - hit.at < SCHEDULE_TTL_MS) return hit.raw;
  const raw = await client.getJson(
    endpoints.eventsDownload(accountId, { region, platform: 'Windows', teamAccountIds: accountId }),
    `events ${region}`,
  );
  cache.set(region, { at: now, raw });
  return raw;
}

/** For tests: forget cached schedules. */
export function clearScheduleCache(): void {
  cache.clear();
}

/** Region to fetch an event's schedule from: its ID suffix, else NAE (global events are in every region). */
export function regionForEvent(eventId: string): Region {
  const suffix = new RegExp(`_(${REGIONS.join('|')})$`).exec(eventId)?.[1];
  return isRegion(suffix) ? suffix : 'NAE';
}

export interface RawWindowRef {
  event: Record<string, unknown>;
  window: Record<string, unknown>;
  templateRules?: unknown;
}

export function findWindow(raw: unknown, eventId: string, windowId: string): RawWindowRef | undefined {
  const doc = asObj(raw);
  const event = asArr(doc?.events)
    .map(asObj)
    .find((e) => str(e?.eventId) === eventId);
  const window = asArr(event?.eventWindows)
    .map(asObj)
    .find((w) => str(w?.eventWindowId) === windowId);
  if (!event || !window) return undefined;
  const templateId = str(window.eventTemplateId);
  const template = asArr(doc?.templates)
    .map(asObj)
    .find((t) => templateId && str(t?.eventTemplateId) === templateId);
  return { event, window, templateRules: template?.scoringRules };
}
