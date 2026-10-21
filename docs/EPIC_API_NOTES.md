# Epic API notes (Phase 0)

**Status: tooling built and tested; no live capture yet.** Every "Expected" line below comes from community libraries and is unverified. Replace each one with what a real capture shows, and tick it off.

The cloud session that built this tooling could not reach `*.epicgames.com` or `fortnite.com` (its network policy blocks them), so the first capture has to run on your machine, or in a session whose network policy allows those hosts.

## Runbook

1. **Secondary account.** Create a fresh Epic account that you'll never play on. Don't use your main account.
2. **Local env.** Run `npm install`, then `cp .env.example .env.local`. The client ID and secret are filled in already.
3. **Device auth (one time).**
   - In a browser, sign in to epicgames.com as the secondary account.
   - Run `npm run epic:device-auth` and open the URL it prints.
   - Copy `authorizationCode` from the JSON. It expires within minutes.
   - Run `npm run epic:device-auth -- <code> --write`. This saves `EPIC_ACCOUNT_ID`, `EPIC_DEVICE_ID` and `EPIC_DEVICE_SECRET` to `.env.local`, and confirms that a token can be minted from them.
4. **First capture.** Run `npm run epic:probe -- --label first`.
   - It writes scrubbed responses to `test/fixtures/epic/first/`, plus `probe-report.json` and `analysis.md`.
   - Calls are spaced at least 1 s apart, so a full run takes about a minute.
5. **More captures.** Re-run with a new `--label` when each state exists:
   - during a live session (`--label live-<event>`)
   - in the hour after one ends (`--label wrapping-<event>`)
   - during an FNCS event, for cumulative boards
   - add `--regions NAE` to keep a run small
6. **Rate limit (once, optional).** `npm run epic:probe -- --label rate --regions NAE --rate-test 30`. This stops at the first 429.
7. **Record the findings.** Copy each `analysis.md` answer into the checklist below. Fill in the response shapes, then ask for Phase 1.
8. **Before committing fixtures,** spot-check them: `grep -ri token test/fixtures/epic/<label>`. You should see only `[redacted]` values and competitive `tokens` lists. The repo should stay private, because fixtures include other players' account IDs.

If the device-auth grant succeeds but events calls return 401/403, set `EPIC_EVENTS_CLIENT_ID` and `EPIC_EVENTS_CLIENT_SECRET` to a second game client. The probe will then exchange into it.

## Checklist

Each item maps to a section of `analysis.md`.

### Token mint (`token`)
- [ ] Device-auth grant works with the Android client.
- [ ] `expires_in`: expected ~7200 s. Is a refresh token issued?
- [ ] Do events calls accept this token, or is an exchange to another client needed?

### Region coverage (`regions`)
- [ ] Does `events/download` without `region=` return every region? Expected: no, so fan out across 8 calls.
- [ ] How do `data` and `download` differ? `data` is tried with `showPastEvents=true`.

### Window fields (`window-fields`)
- [ ] Which of these are present: `beginTime`, `endTime`, `countdownBeginTime`, `round`, `payoutDelay`, `isTBD`, `canLiveSpectate`, `blackoutPeriods`, `scoreLocations`, the token requirements, `teammateEligibility`?
- [ ] `payoutDelay` unit: expected minutes. If it's missing, the app assumes 60.

### Scoring and payouts (`scoring`)
- [ ] Where do they live? Expected: `templates[].scoringRules[]` for placement and elimination points, and top-level `scoringRuleSets` / `payoutTables` keyed from the window.

### Leaderboard (`leaderboard`)
- [ ] Page size and `totalPages`. Expected: 100 per page, top 10,000.
- [ ] Entry shape. Expected: `teamAccountIds[]`, `rank`, `pointsEarned`, `pointBreakdown`, and `sessionHistory[].trackedStats` with `PLACEMENT_STAT_INDEX`, `TEAM_ELIMS_STAT_INDEX`, `VICTORY_ROYALE_STAT`, `MATCH_PLAYED_STAT`.
- [ ] What `showLiveSessions=true` adds during a live window.

### Direct lookup of one team (`filtered`)
- [ ] Does `teamAccountIds=` return just that team's row? If not, `/api/player` scans final boards once and caches the result for 24 h.

### Cumulative boards (`cumulative`)
- [ ] Are they separate window IDs? Check an FNCS event with several sessions (design decision D7).

### Accounts (`bulk-accounts`, `by-name`)
- [ ] Bulk lookup limit: expected 100. The probe sends 100, then 101.
- [ ] Shape of the display name lookup response.

### Rate limit (`rate`)
- [ ] Back-to-back requests before the first 429, and the `Retry-After` value.

### CMS (`cms`)
- [ ] How to join it to events. Expected: event `displayDataId` matches CMS `tournament_display_id`.

### Other endpoints (`history-window`, `history-player`, `tokens`, `errors`)
- [ ] Whether the window and player history endpoints are usable, and their shapes.
- [ ] Shape of the player tokens response.
- [ ] Error envelope. Expected: `{ errorCode, errorMessage, numericErrorCode }`. Record the 401 and 404 codes.

## Response shapes (fill in from fixtures)

_Empty until the first capture._

## Gate 0

- [ ] Every endpoint used in Phases 1 and 2 has a saved fixture and a recorded shape.
- [ ] If the token flow or the leaderboard endpoint doesn't work: stop and switch the primary source to the fortnite.com/competitive fallback, as the implementation plan says.
