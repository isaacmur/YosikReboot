// Shapes the API routes return. The browser only ever sees these, never Epic's
// raw format (see docs/EPIC_API_NOTES.md for the raw shapes they come from).

export const REGIONS = ['NAC', 'NAE', 'NAW', 'EU', 'BR', 'OCE', 'ME', 'ASIA'] as const;
export type Region = (typeof REGIONS)[number];

export function isRegion(v: unknown): v is Region {
  return typeof v === 'string' && (REGIONS as readonly string[]).includes(v);
}

export type WindowState = 'upcoming' | 'live' | 'wrapping' | 'final';

/** From Epic's `metadata.tournamentType`; promo cups are Epic's "ShopCup". */
export const EVENT_TYPES = [
  'FNCS',
  'RANKED_CUP',
  'PROMO_CUP',
  'CASH_CUP',
  'VICTORY_CUP',
  'PERF_EVAL',
  'OTHER',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Battle Royale or Reload map pool; build vs. zero build is separate (`zeroBuild`). */
export type Mode = 'BR' | 'RELOAD' | 'OTHER';
export type TeamSize = 1 | 2 | 3 | 4;
export type PlatformGroup = 'PC' | 'CONSOLE' | 'MOBILE' | 'CLOUD';

/** One session (Epic calls it an event window). Times are UTC ISO strings. */
export interface EventWindow {
  id: string;
  eventId: string;
  round: number;
  /** Readable name derived from the window ID, e.g. "Event 3" or "Final Day 1". */
  label: string;
  begin: string;
  end: string;
  /** Minutes after `end` during which standings can still change. */
  payoutDelayMin: number | null;
  isTBD: boolean;
  /** Plain-language entry rules for this session (qualification, rank, 2FA). */
  requirements: string[];
}

export interface EventInfo {
  id: string;
  /** Region from the event ID suffix; GLOBAL for events with no suffix. */
  homeRegion: Region | 'GLOBAL';
  /** Regions whose players can see and enter it. */
  regions: Region[];
  name: string;
  subtitle?: string;
  description?: string;
  type: EventType;
  mode: Mode;
  zeroBuild: boolean;
  teamSize: TeamSize | null;
  mobileOnly: boolean;
  platforms: PlatformGroup[];
  minAccountLevel: number | null;
  posterUrl?: string;
  tileUrl?: string;
  /** Hex color without '#', from the CMS. */
  color?: string;
  windows: EventWindow[];
}

/** GET /api/events?region= */
export interface EventsResponse {
  region: Region;
  fetchedAt: string;
  events: EventInfo[];
}

/** GET /api/health. Reflects one warm function instance, not every instance. */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  instanceStartedAt: string;
  /** Names of missing environment variables, if any (never values). */
  missingConfig: string[];
  token: { mintedAt?: string; expiresAt?: string; lastError?: string; consecutiveFailures: number };
  upstream: {
    consecutiveFailures: number;
    recent: { at: string; label: string; status: number; ms: number; errorCode?: string }[];
  };
}
