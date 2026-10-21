// Every Epic URL the app uses, in one place, so an Epic change is a one-file fix.
// Paths come from community endpoint lists (see docs/DEVELOPER_PLAN.md) and are
// unverified until Phase 0 records a live response for each.

export const HOSTS = {
  account: 'https://account-public-service-prod.ol.epicgames.com',
  events: 'https://events-public-service-live.ol.epicgames.com',
  cms: 'https://fortnitecontent-website-prod07.ol.epicgames.com',
  datastorage: 'https://datastorage-public-service-live.ol.epicgames.com',
  web: 'https://www.epicgames.com',
} as const;

export const GAME_ID = 'Fortnite';

/** Max account IDs per bulk lookup (Phase 0 confirms). */
export const BULK_ACCOUNT_LIMIT = 100;

type Params = Record<string, string | number | boolean | undefined>;

const seg = encodeURIComponent;

function withQuery(url: string, params: Params = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `${url}?${s}` : url;
}

export interface LeaderboardParams {
  page?: number;
  rank?: number;
  teamAccountIds?: string[];
  showLiveSessions?: boolean;
}

export const endpoints = {
  oauthToken: () => `${HOSTS.account}/account/api/oauth/token`,
  oauthExchange: () => `${HOSTS.account}/account/api/oauth/exchange`,
  /** Device code flow: returns a link the account owner opens and approves. */
  oauthDeviceAuthorization: () => `${HOSTS.account}/account/api/oauth/deviceAuthorization`,
  oauthKillSession: (accessToken: string) => `${HOSTS.account}/account/api/oauth/sessions/kill/${seg(accessToken)}`,
  /** Opened in a signed-in browser to get a one-time authorization code. */
  authorizationCodeRedirect: (clientId: string) =>
    withQuery(`${HOSTS.web}/id/api/redirect`, { clientId, responseType: 'code' }),
  deviceAuth: (accountId: string) => `${HOSTS.account}/account/api/public/account/${seg(accountId)}/deviceAuth`,

  accountByName: (displayName: string) => `${HOSTS.account}/account/api/public/account/displayName/${seg(displayName)}`,
  accountsById: (ids: string[]) => {
    if (ids.length === 0 || ids.length > BULK_ACCOUNT_LIMIT) {
      throw new RangeError(`accountsById takes 1-${BULK_ACCOUNT_LIMIT} ids, got ${ids.length}`);
    }
    return withQueryRepeated(`${HOSTS.account}/account/api/public/account`, 'accountId', ids);
  },
  /** Unchecked variant, only for probing the real limit. */
  accountsByIdUnchecked: (ids: string[]) =>
    withQueryRepeated(`${HOSTS.account}/account/api/public/account`, 'accountId', ids),

  eventsData: (accountId: string, params: Params = {}) =>
    withQuery(`${HOSTS.events}/api/v1/events/${GAME_ID}/data/${seg(accountId)}`, params),
  eventsDownload: (accountId: string, params: Params = {}) =>
    withQuery(`${HOSTS.events}/api/v1/events/${GAME_ID}/download/${seg(accountId)}`, params),

  leaderboard: (eventId: string, windowId: string, accountId: string, p: LeaderboardParams = {}) =>
    withQuery(`${HOSTS.events}/api/v1/leaderboards/${GAME_ID}/${seg(eventId)}/${seg(windowId)}/${seg(accountId)}`, {
      page: p.page ?? 0,
      rank: p.rank ?? 0,
      teamAccountIds: (p.teamAccountIds ?? []).join(','),
      appId: GAME_ID,
      showLiveSessions: p.showLiveSessions ?? false,
    }),
  windowHistory: (eventId: string, windowId: string) =>
    `${HOSTS.events}/api/v1/events/${GAME_ID}/${seg(eventId)}/${seg(windowId)}/history`,
  playerWindowHistory: (eventId: string, windowId: string, accountId: string) =>
    `${HOSTS.events}/api/v1/events/${GAME_ID}/${seg(eventId)}/${seg(windowId)}/history/${seg(accountId)}`,
  playerTokens: (accountIds: string[]) =>
    withQuery(`${HOSTS.events}/api/v1/players/${GAME_ID}/tokens`, {
      teamAccountIds: accountIds.join(','),
    }),

  tournamentInfo: () => `${HOSTS.cms}/content/api/pages/fortnite-game/tournamentinformation`,

  /** A tournament game's server replay (D31): its parts and events, by match ID (a game's `sessionId`). */
  replayMetadata: (matchId: string) => `${HOSTS.datastorage}/api/v1/data/fnreplaysmetadata/public/${seg(matchId)}.json`,
  /** POST { files: ["<part id>.bin", …] } for signed download links, good for 15 minutes. */
  replayFiles: (matchId: string) => `${HOSTS.datastorage}/api/v1/access/fnreplays/public/${seg(matchId)}/`,
};

function withQueryRepeated(url: string, key: string, values: string[]): string {
  const q = new URLSearchParams();
  for (const v of values) q.append(key, v);
  return `${url}?${q}`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new RangeError('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
