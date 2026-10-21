# Epic API notes (Phase 0)

**Status: Phase 0 complete. Live captures on 2026-10-21: `first` (all regions) and `second` (NAC, with Ranked Cup tier boards), both anonymized in `test/fixtures/epic/`.** Epic answered all 29 probe calls. The capture caught an upcoming window, a live one, one wrapping up, and finished ones, across 273 events and 1,189 windows. Eight follow-up calls were made by hand afterwards. Everything below comes from those responses unless it's marked otherwise.

The anonymized copy is committed as `test/fixtures/epic/first/`; the raw capture is not. See [Fixtures and privacy](#fixtures-and-privacy).

## Runbook

1. **Secondary account.** Create a fresh Epic account that you'll never play on. Don't use your main account.
2. **Local env.** Run `npm install`, then `cp .env.example .env.local`. The client IDs and secrets are filled in already.
3. **Device auth (one time).** Run `npm run epic:device-auth -- --link --expect <secondary display name> --write`.
   - It prints an epicgames.com/activate link. Open it on any device, sign in as the secondary account, and approve. No password or code is typed into the tool.
   - `--expect` refuses any other account. If your browser is signed in to your main account, nothing is created for it.
   - It saves `EPIC_ACCOUNT_ID`, `EPIC_DEVICE_ID` and `EPIC_DEVICE_SECRET` to `.env.local`, and confirms that a token can be minted from them.
   - Fallback without `--link`: run `npm run epic:device-auth` for the authorization-code steps.
4. **Capture.** Run `npm run epic:probe -- --label <name>`. Add `--regions NAE` to keep a run small.
   - It writes scrubbed responses to `captures/epic/<name>/` (git-ignored), plus `probe-report.json` and `analysis.md`.
   - Then run `npm run epic:anonymize -- captures/epic/<name>` to make the publishable copy under `test/fixtures/epic/`.
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
- [x] **Region responses overlap.** A `region=X` response lists every event whose `regions` array contains X.
  - NA has no `_NAE` events this season: a NAE request returns NAC and NAW events.
  - NAC and NAW share many events.
  - One global event (`epicgames_Bog_Official`) is in all eight.
  - So: take an event's home region from its ID suffix, and de-duplicate by `eventId` across the 8 calls. A region view shows the events whose `regions` include it, as Epic's own Compete tab does.
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
- [x] **Scoring semantics, verified in Phase 2.** Each `rewardTier` pays `pointsEarned` when the stat is at or better than `keyValue`: `<=` for `lte` (places), `>=` for `gte` (eliminations). Tiers add up, and `multiplicative` tiers pay `pointsEarned × stat`. Summing the board's rules over each match's `trackedStats` reproduces Epic's `pointsEarned` for every entry checked: 100 of 100 on a regular board, and 245 of 245 across three Ranked Cup tier boards.
- [x] Use the **score location's** rule set (`scoreLocationScoringRuleSets`), not the window template's. They differ, as for the Slender Man Cup.
- [x] Payout tables have `scoringType` `rank`, `percentile` (`threshold` 0.05 = top 5%) or `value` (points reached). Rewards are `ecomm` (cash; `value: "USD"`), `game` (cosmetics) or `token` (qualifies for the window named in `value`).
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
  - `pointBreakdown`, keyed `"STAT:value"` with `{ timesAchieved, pointsEarned }`. Its points add up to `pointsEarned`; the app splits them into placement and eliminations for the tournament card.
  - `percentile` is 0 even for top teams on the captured final boards, so Top % comes from the team count instead.
  - Session stats are per team only: placement, team eliminations, time alive, Victory Royale, matches played. No damage, accuracy, healing or materials (those are in match replays).
  - `sessionHistory[]` (one per match, at most `maxSessionHistorySize`), each `{ sessionId, endTime, trackedStats }`
  - `playerFlagTokens` (account ID to `GroupIdentity_GeoIdentity_<country>`)
  - `unscoredSessions[]`
- [x] `trackedStats` are `PLACEMENT_STAT_INDEX`, `TEAM_ELIMS_STAT_INDEX`, `MATCH_PLAYED_STAT`, `VICTORY_ROYALE_STAT`, `TIME_ALIVE_STAT` and `PLACEMENT_TIEBREAKER_STAT`. On ranked-cup boards each stat is also repeated with the tier as a prefix, e.g. `DIAMOND_PLACEMENT_STAT_INDEX`.
- [x] **No display names on entries.** Names come from the bulk account lookup (D3 confirmed).
- [x] `showLiveSessions=true` changed nothing during a live window: `liveSessions` came back `{}`.

### Looking up one player or team
- [x] **`teamAccountIds=` only accepts the signed-in account's own team.** Any other account returns 400 `com.epicgames.api.malformed_data`, however the IDs are formatted (single ID, encoded comma, literal comma). The service account's own ID returns 200 with no entries.
- [x] `events/download/{otherAccountId}` returns 403 `forbidden`.
- [x] Window history (`/history`) returns 404, and player history (`/history/{id}`) returns 403 for another account: `Fortnite:profile:<id>:commands READ` is missing. That permission is the signed-in account's own, so your own history is read during a sync (D30).
- **Consequence (D10):** results for you and your follows have to come from scanning finished boards, top 10,000 only. This matches Fortnite Tracker's own top-10K limit.

### Tournament replays (D31, not yet captured)
- Per the open-source downloader (`fortnite-replay-downloader`, Feb 2025): `GET https://datastorage-public-service-live.ol.epicgames.com/api/v1/data/fnreplaysmetadata/public/{matchId}.json` with an app token (client credentials for the Android client, `token_type=eg1`) returns `LengthInMS`, `bIsLive`, `bCompressed` and the parts: `Events` (`Id`, `Group`, `Metadata`, `Time1`, `Time2`), `DataChunks` and `Checkpoints`.
- `POST https://datastorage-public-service-live.ol.epicgames.com/api/v1/access/fnreplays/public/{matchId}/` with `{ "files": ["header.bin", "<part id>.bin", …] }` returns `files["<name>"].readLink`, a signed link good for 15 minutes.
- The match ID is a game's `sessionId` from a leaderboard row. Every competitive session this season has `ServerReplays: true` except the Arena test cup. Replays are kept about one to two weeks, and can be deleted sooner.
- Event layouts (from replay-reader, MIT): `playerElim` is a header (165 bytes on current versions), the eliminated and the eliminator (type 17, a spare byte, a 16-byte account ID; or type 3 for a bot), a weapon-type byte and a 4-byte knocked flag. `AthenaMatchStats` is 4 bytes, a float accuracy, then ten counts (assists, eliminations, weapon damage, other damage, revives, damage taken, damage to structures, materials gathered, materials used, distance).
- [ ] On the first real read: that the endpoints answer for this season's match IDs, that the event parts aren't encrypted, and whether `AthenaMatchStats` events name their player. The card's "What the replays held" shows each.

### Cumulative and ranked tier boards
- [x] Cumulative boards **are not windows**. FNCS windows list a second score location, `Fortnite:cumulative:<eventId>_cumulative`, with a `*_CumulativeLeaderboardDef`. Payout tables point at it through `scoreId`.
- [x] The leaderboard endpoint does **not** serve them under any pairing tried (`cumulative/<eventId>_cumulative` and `<eventId>/<eventId>_cumulative` both return 404). **D7 resolved:** compute cumulative standings from the session boards.
- [x] **Corrected in Phase 2.** Ranked Cups have one score location per rank tier besides the main board, and the tier boards **are** fetchable.
  - Use the exact instance ID listed in `resolvedWindowLocations` as the window ID, e.g. `S42_RankedCupSoloReload_Event8_NAC_2_diamond`. The number is the window's `round` (round 2 here), and capitalization varies (`_2_Bronze`, `_2_gold`).
  - Phase 0's 404 came from guessing `_1_` for a round-2 window.
  - The **main Ranked Cup board has no points.** It's scored with `EmptyScoringRules` (`pointsEarned` 0, `score` 1 for everyone), so the real standings are the tier boards, scored on tier-prefixed stats (`DIAMOND_PLACEMENT_STAT_INDEX`, …).
  - Verified on all 8 tier boards of a live window: second capture, `test/fixtures/epic/second/`.

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
- [x] Sync with Epic (D30), first real sync: `player.teams` in your own schedule download listed **one** session, not the ones you'd played. It isn't a history (it may be the events you have a team set up for), so a sync now reads sessions one by one instead of trusting it.
- [x] Sync with Epic, second real sync: a board filtered with `teamAccountIds=` set to just you found 1 result in 60 sessions (a solo one). It missed a duos Ranked Cup you'd played (just you isn't your team), and anything outside your region's newest 60 sessions. A sync now reads your per-event history instead.
- [x] Sync with Epic, third real sync: `/api/v1/events/Fortnite/{eventId}/history/{yourId}` answers for your own account. It returned 5 results from 149 events, including another region's session and ranks past the top 10,000 (14,839th, 65,944th), which boards can't reach. What it missed were events Epic's schedule no longer lists (below), so they were never asked about.
- [x] **Epic's schedule keeps an event only about a week after it ends.** In the first capture (2026-10-21) the oldest event ended 2026-10-13. `/data/` with `showPastEvents=true` (`events-data-NAC.json`) stops at the same week; its extra 10 events are mobile and console ones, which the Windows download leaves out. Nothing else in Epic's API lists older events, so the app keeps every event it sees (D32). Fortnite Tracker's event IDs are `epicgames_<fortnite.com event>_<region>`, e.g. `epicgames_S42_FNCSSoloQualifiers_NAC` with windows `S42_FNCSSoloQualifiers_Qual1Round1Day1_NAC`.
- [ ] Sync with Epic: that the history answers for events Epic no longer lists, and what its Ranked Cup scores look like (`scoreKey.eventWindowId` set to a tier's ID, or `_scoreId` naming it). Also what `scores` in your own schedule download holds. The sync's "What Epic returned" shows these.
- [ ] Player tokens (`/api/v1/players/Fortnite/tokens`) work but are empty for a new account, so the eligibility feature (F9, Later) needs your own account's tokens.

## Gate 0

- [x] The token flow and the leaderboard endpoint both work, so the fortnite.com fallback isn't needed.
- [x] Every endpoint used in Phases 1 and 2 has a recorded response shape.
- [x] Anonymized fixtures for parser tests are committed.

## Fixtures and privacy

Raw captures go to `captures/epic/<label>/`, which is git-ignored because it holds other players' account IDs, country flags and display names. `npm run epic:anonymize -- captures/epic/<label>` writes the publishable copy to `test/fixtures/epic/<label>/`:
- Account and session IDs become consistent stand-ins.
- Display names become `PlayerNNNNN`.
- Country flags and spectate tokens are redacted.

It then re-checks the output against the raw capture and refuses (exit 2) if any ID, name, country or token survived. `test/fixtures/epic/first/` is the anonymized first capture, and `test/fixtures.test.ts` checks that it still hangs together.
