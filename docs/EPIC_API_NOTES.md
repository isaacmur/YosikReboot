# Epic API notes (Phase 0)

**Status: first live capture done on 2026-10-21, label `first`.** Epic answered all 29 probe calls. The capture caught an upcoming window, a live one, one wrapping up, and finished ones, across 273 events and 1,189 windows. Eight follow-up calls were made by hand afterwards. Everything below comes from those responses unless it's marked otherwise.

The raw capture is **not committed**: the repo is public and the capture contains other players' data. See [Fixtures and privacy](#fixtures-and-privacy).

## Runbook

1. **Secondary account.** Create a fresh Epic account that you'll never play on. Don't use your main account.
2. **Local env.** Run `npm install`, then `cp .env.example .env.local`. The client IDs and secrets are filled in already.
3. **Device auth (one time).** Run `npm run epic:device-auth -- --link --expect <secondary display name> --write`.
   - It prints an epicgames.com/activate link. Open it on any device, sign in as the secondary account, and approve. No password or code is typed into the tool.
   - `--expect` refuses any other account. If your browser is signed in to your main account, nothing is created for it.
   - It saves `EPIC_ACCOUNT_ID`, `EPIC_DEVICE_ID` and `EPIC_DEVICE_SECRET` to `.env.local`, and confirms that a token can be minted from them.
   - Fallback without `--link`: run `npm run epic:device-auth` for the authorization-code steps.
4. **Capture.** Run `npm run epic:probe -- --label <name>`. Add `--regions NAE` to keep a run small.
   - It writes scrubbed responses to `test/fixtures/epic/<name>/`, plus `probe-report.json` and `analysis.md`.
   - Calls are spaced at least 1 s apart, so a full run takes about 30 s.
5. **Rate limit (once, optional).** `npm run epic:probe -- --label rate --regions NAE --rate-test 30`. This stops at the first 429.
6. **Record the findings** below.

In a cloud session, prefix commands with `NODE_USE_ENV_PROXY=1`, so Node's fetch uses the session proxy. The environment's network access must allow `account-public-service-prod.ol.epicgames.com`, `events-public-service-live.ol.epicgames.com` and `fortnitecontent-website-prod07.ol.epicgames.com`.

## Findings

### Auth
- [x] Link sign-in works: device code flow with the Switch client, then an exchange into the Android client, then a device auth on the Android client.
- [x] The device-auth grant with the Android client works: `expires_in` is 7200 s and a refresh token is issued.
- [x] The events service accepts that token directly, so no second client is needed.

### Schedule (`GET /api/v1/events/Fortnite/download/{accountId}?region=&platform=&teamAccountIds={self}`)
- [x] **`region=` is required.** Without it the call returns 400 `MissingQueryParamRejection`, so `/api/events` fans out with one call per region.
- [x] Events per region: NAC 50, NAW 50, NAE 32, EU 29, and 28 each for BR, OCE, ME and ASIA.
- [x] Responses are large: about 1.2 to 1.9 MB of JSON per region (indented as saved). The route must trim before caching.
- [x] Top-level keys: `player`, `events`, `templates`, `scoringRuleSets`, `payoutTables`, `leaderboardDefs`, `scoreLocationScoringRuleSets`, `scoreLocationPayoutTables`, `resolvedWindowLocations`, `eventSeries`, `scores`.
  - `/data/` returns the same keys minus `player` and `scores`.
  - `player` is the service account's own tokens, teams and pending payouts. It's useless to the app.
- [x] Event keys: `eventId`, `regions`, `regionMappings`, `platforms`, `platformMappings`, `displayDataId`, `eventGroup`, `announcementTime`, `beginTime`, `endTime`, `link`, `metadata`, `eventWindows`.
- [x] Window fields are present on 1,189 of 1,189 windows. That covers every field in the developer plan, plus `visibility`, `additionalRequirements`, `requireAllTokensCaller`, `requireAnyTokensCaller` and `regionMappings`.
  - `teammateEligibility` is always `all`, and `visibility` is always `public`.
  - `metadata` holds `RoundType`, `SubgroupId`, `ServerReplays`, `liveSpectateAccessToken`, `alternativeScoreLocationIndex`, `hideScoreLocationsIndexes` and `ForceDisplayLeaderboards`.
- [x] `payoutDelay` ranges from 10 to 32 and is consistent with minutes. A board 30 minutes past its end with `payoutDelay` 32 was still changing. Treat the unit as minutes.

### Scoring and payouts
- [x] A **score location** is `Fortnite:<group>:<instance>`. A window's own board is `Fortnite:<eventId>:<windowId>`.
- [x] `window.scoreLocations[]` is a list of `{ leaderboardDefId, isMainWindowLeaderboard }`. A board's scoring and payouts are looked up in two steps:
  - `scoreLocationScoringRuleSets[location]` gives an ID into `scoringRuleSets`.
  - `scoreLocationPayoutTables[location]` gives an ID into `payoutTables`.
- [x] `scoringRuleSets[id]` is a list of rules, each `{ trackedStat, matchRule: "lte", rewardTiers: [{ keyValue, pointsEarned, multiplicative }] }`. Placement and elimination points come from rules on `PLACEMENT_STAT_INDEX` and `TEAM_ELIMS_STAT_INDEX`.
- [x] `payoutTables[id]` is a list of tables, each `{ scoringType: "rank", ranks: [{ threshold, payouts: [{ rewardType, rewardMode, value, quantity }] }] }`.
  - Cash is `rewardType: "ecomm"`, `value: "USD"`; `quantity` is in dollars (the FNCS final NAC table pays 50000 for first).
  - Qualification and cutoff lines come from the `threshold` values.
- [x] Templates, looked up through the window's `eventTemplateId`, have `playlistId`, `matchCap`, `scoringRules`, `payoutTable`, `tiebreakerFormula`, `liveSessionAttributes` and `clampsToZero`. The playlist ID gives the mode and team size, e.g. `..._NoBuildSolo_...`.
- [x] `leaderboardDefs[]` has `leaderboardInstanceGroupingKeyFormat` and `leaderboardInstanceIdFormat`, which say how each score location is named.

### Leaderboards (`GET /api/v1/leaderboards/Fortnite/{eventId}/{windowId}/{accountId}?page=&rank=0&teamAccountIds=&appId=Fortnite&showLiveSessions=false`)
- [x] **100 entries per page, up to 100 pages (the top 10,000).** One finished duos board had all 100 pages; a live solo board had 62.
- [x] Top-level keys: `gameId`, `eventId`, `eventWindowId`, `page`, `totalPages`, `updatedTime`, `entries`, `liveSessions`.
- [x] Entry fields:
  - `teamAccountIds[]` and `teamId` (`<id>:<id>`)
  - `rank`, `pointsEarned`, `score`, `percentile`
  - `pointBreakdown`, keyed `"STAT:value"` with `{ timesAchieved, pointsEarned }`
  - `sessionHistory[]` (one per match, at most `maxSessionHistorySize`), each `{ sessionId, endTime, trackedStats }`
  - `playerFlagTokens` (account ID to `GroupIdentity_GeoIdentity_<country>`)
  - `unscoredSessions[]`
- [x] `trackedStats` are `PLACEMENT_STAT_INDEX`, `TEAM_ELIMS_STAT_INDEX`, `MATCH_PLAYED_STAT`, `VICTORY_ROYALE_STAT`, `TIME_ALIVE_STAT` and `PLACEMENT_TIEBREAKER_STAT`. On ranked-cup boards each stat is also repeated with the tier as a prefix, e.g. `DIAMOND_PLACEMENT_STAT_INDEX`.
- [x] **No display names on entries.** Names come from the bulk account lookup (D3 confirmed).
- [x] `showLiveSessions=true` changed nothing during a live window: `liveSessions` came back `{}`.

### Looking up one player or team
- [x] **`teamAccountIds=` only accepts the signed-in account's own team.** Any other account returns 400 `com.epicgames.api.malformed_data`, however the IDs are formatted (single ID, encoded comma, literal comma). The service account's own ID returns 200 with no entries.
- [x] `events/download/{otherAccountId}` returns 403 `forbidden`.
- [x] Window history (`/history`) returns 404, and player history (`/history/{id}`) returns 403. Neither is usable.
- **Consequence (D10):** results for you and your follows have to come from scanning finished boards, top 10,000 only. This matches Fortnite Tracker's own top-10K limit.

### Cumulative and ranked tier boards
- [x] Cumulative boards **are not windows**. FNCS windows list a second score location, `Fortnite:cumulative:<eventId>_cumulative`, with a `*_CumulativeLeaderboardDef`. Payout tables point at it through `scoreId`.
- [x] The leaderboard endpoint does **not** serve them under any pairing tried (`cumulative/<eventId>_cumulative` and `<eventId>/<eventId>_cumulative` both return 404). **D7 resolved:** compute cumulative standings from the session boards.
- [x] Ranked cups have per-tier score locations (`<windowId>_1_Bronze` … `_1_unreal`, with inconsistent capitalization) as well as the main board. `<windowId>_1_diamond` returns 404 `event_window_not_found`, so the main board is the one to use.

### Accounts
- [x] Bulk lookup: `GET /account/api/public/account?accountId=…` (repeat the parameter) accepts **at most 100**. Sending 101 returns 400 `errors.com.epicgames.account.invalid_account_id_count`. Each entry is `{ id, displayName, externalAuths, links }`.
- [x] Display name lookup: `GET /account/api/public/account/displayName/{name}`.
  - For another player it returns `{ id, displayName, externalAuths }`.
  - For the service account itself it returns the full private profile (email, real name, country). The probe now saves only `id` and `displayName`.

### CMS (`tournamentinformation`, no auth, about 0.9 MB)
- [x] 45 of 45 event `displayDataId` values appear in it. Each tournament key (e.g. `s42Cyberpunk`) holds `tournament_info` with `tournament_display_id` plus titles, colors and posters. Cache it for 24 h.

### Errors
- [x] The events service error envelope is `{ errorCode, errorMessage, code, message, status, context }`. Codes seen:
  - `errors.com.epicgames.common.unauthorized` (401, no token)
  - `com.epicgames.events.event_window_not_found` / `event_not_found` (404)
  - `errors.com.epicgames.common.forbidden` (403)
  - `com.epicgames.api.malformed_data` (400)
  - `errors.com.epicgames.common.rejection.MissingQueryParamRejection` (400)

### Still open
- [ ] Rate limit: not tested yet. Run step 5 once.
- [ ] Player tokens (`/api/v1/players/Fortnite/tokens`) work but are empty for a new account, so the eligibility feature (F9, Later) needs your own account's tokens.

## Gate 0

- [x] The token flow and the leaderboard endpoint both work, so the fortnite.com fallback isn't needed.
- [x] Every endpoint used in Phases 1 and 2 has a recorded response shape.
- [ ] Commit fixtures for parser tests. This is blocked on the fixtures decision below.

## Fixtures and privacy

The capture holds about 10,000 other players' account IDs, their country flags (`playerFlagTokens`) and, from the bulk lookup, display names. The probe now strips account profiles down to `id` and `displayName`.

While the repo is public, captures stay local: `test/fixtures/epic/*/` is git-ignored. To commit fixtures, either make the repo private, or anonymize them first by replacing account IDs and display names with stable stand-ins.
