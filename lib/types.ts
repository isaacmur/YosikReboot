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

/**
 * Who a session is for (D27). `open`: anyone who meets the account rules.
 * `qualified`: only players who earned a spot (or an invite), and it qualifies
 * players onward (heats, middle rounds). `final`: qualified players only, and
 * nothing after it.
 */
export type Stage = 'open' | 'qualified' | 'final';

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
  stage: Stage;
}

/** Tournament artwork and colors from Epic's CMS; any of it can be missing. */
export interface EventArt {
  /** Square poster, 800×800. */
  square?: string;
  /** 16:9 tile, 1920×1080. */
  tile?: string;
  /** Wide background, about 1560×1024. */
  background?: string;
  /** Hex colors without '#'. */
  primary?: string;
  left?: string;
  right?: string;
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
  art: EventArt;
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

// --- Leaderboards (Phase 2) -------------------------------------------------

/** A window's boards: the main one, one per Ranked Cup tier, and FNCS cumulative. */
export type BoardKind = 'main' | 'tier' | 'cumulative';

/** Points by finishing place and by eliminations, worked out from Epic's rules. */
export interface ScoringSummary {
  /** Points for each place that scores, best place first. */
  placement: { place: number; points: number }[];
  /** Points for each elimination count that scores, 1 upward. */
  elims: { elims: number; points: number }[];
}

export interface PayoutTier {
  /** What `threshold` measures: a rank, a top fraction (0.05 = top 5%), or points reached. */
  basis: 'rank' | 'percentile' | 'points';
  threshold: number;
  /** Plain-language rewards, e.g. "$600", "Qualifies for Event 5 Round 2", "Glider". */
  rewards: string[];
  /** True if any reward is a qualification token (a cutoff line, not just a prize). */
  qualifies: boolean;
  /**
   * Which of the board's payout tables this tier is in. Within a table a rank
   * (or percentile) earns its nearest tier at or after it; points tiers add up.
   */
  table: number;
  /** Cash in this tier, in US dollars (0 if none). */
  usd: number;
}

/**
 * A line on the board where a reward stops: the furthest place that qualifies
 * for each next round, the last paid place, and the edge of each item tier.
 */
export interface Cutoff {
  /** What `threshold` measures, as for a payout tier. */
  basis: PayoutTier['basis'];
  /** Last rank inside the line, the top fraction (0.05 = top 5%), or the points needed. */
  threshold: number;
  /** `skin`: the last place that wins a skin, with whatever else that tier gives. */
  kind: 'qualify' | 'cash' | 'skin' | 'item';
  /** What crossing it gets you, e.g. "Qualifies for Event 5 Round 2", "Cash prizes", "Skin, Pickaxe". */
  label: string;
}

export interface BoardInfo {
  /** Epic's leaderboard instance ID; pass back as `board=`. */
  id: string;
  kind: BoardKind;
  label: string;
  /** Cumulative boards are computed by the app, not fetched from Epic (D7). */
  computed: boolean;
  /** False for Ranked Cup main boards, which Epic scores with empty rules. */
  hasPoints: boolean;
  scoring: ScoringSummary | null;
  payouts: PayoutTier[];
  cutoffs: Cutoff[];
}

/** GET /api/window */
export interface WindowDetail {
  eventId: string;
  windowId: string;
  boards: BoardInfo[];
  /** The board to show first: the main board if it scores, else the top tier. */
  defaultBoard: string;
}

export interface MatchResult {
  /** Epic's ID for the game: every team in the same game has the same one (D28). */
  sessionId: string;
  endedAt: string;
  place: number | null;
  elims: number;
  points: number | null;
  victory: boolean;
  /** Seconds the team survived. */
  timeAlive: number | null;
}

export interface EntryMember {
  id: string;
  /** Missing in `lite` responses. */
  name?: string;
}

export interface Entry {
  rank: number;
  /** Member account IDs, sorted and joined by ':'. */
  teamKey: string;
  members: EntryMember[];
  points: number;
  matches: number;
  victories: number;
  elims: number;
  avgPlace: number | null;
  /** Oldest first. Empty in `lite` responses. */
  sessions: MatchResult[];
  /** `lite` responses only: each game's points, oldest first; missing when a game's points are unknown (D29). */
  gamePoints?: number[];
}

/** GET /api/leaderboard */
export interface LeaderboardPage {
  eventId: string;
  windowId: string;
  board: string;
  page: number;
  totalPages: number;
  fetchedAt: string;
  /** Cumulative only: some sessions have more teams than were summed. */
  approximate?: boolean;
  entries: Entry[];
}

// --- Sync with Epic (D30): your own sign-in, for the minutes a sync takes ---

/** A session to read your row from; `team` is your team's account IDs when Epic listed them. */
export interface SyncSession {
  eventId: string;
  windowId: string;
  team?: string[];
}

/** POST /api/sync?step=start: open `url`, sign in and approve. */
export interface SyncStart {
  url: string;
  code: string;
  expiresAt: string;
  intervalMs: number;
}

/** What your own schedule download held, for the sync's details. */
export interface SyncEpicInfo {
  /** Keys of its `player` part. */
  playerKeys: string[];
  /** Entries in `player.teams`, and tokens you hold. */
  teams: number;
  tokens: number;
}

/**
 * POST /api/sync?step=poll. `played` is what `player.teams` lists, null when it's
 * empty; it turned out not to be a history of what you played (D30), so it's only
 * one source of sessions to read.
 */
export type SyncPoll =
  | { status: 'pending'; intervalMs: number }
  | {
      status: 'ready';
      accountId: string;
      displayName: string | null;
      played: SyncSession[] | null;
      epic: SyncEpicInfo;
    };

/** POST /api/sync?step=probe: Epic's per-player history for one session, as an outline. */
export interface SyncProbe {
  history: string;
}

export interface SyncRowResult {
  eventId: string;
  windowId: string;
  status: 'found' | 'not_found' | 'not_final' | 'unknown';
  board?: Pick<BoardInfo, 'id' | 'label' | 'payouts'>;
  /** Your row, without names or games (`lite`). */
  entry?: Entry;
  /** What Epic answered for each board tried. */
  trace?: string[];
}

/** POST /api/sync?step=rows: what was read, and what's left for the next request. */
export interface SyncRows {
  results: SyncRowResult[];
  remaining: SyncSession[];
}

/** GET /api/ics, signed in: the calendar feed's secret for the subscribe link; null while the feed is off. */
export interface CalendarFeed {
  token: string | null;
}

/** GET /api/player */
export interface PlayerLookup {
  id: string;
  displayName: string;
}
