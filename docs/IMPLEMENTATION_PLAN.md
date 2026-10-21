# YosikReboot — Implementation Plan

Companion to [`DEVELOPER_PLAN.md`](./DEVELOPER_PLAN.md) (the product spec). That doc says **what** to build; this one says **how and in what order**: repo layout, module boundaries, the phase-by-phase task list with acceptance checks, and the design decisions that have to be made before code is written.

Feature numbers (`F1`–`F37`) refer to the feature tables in the developer plan.

---

## 1. Design decisions to lock before Phase 1

These are gaps or traps in the spec that change code structure. Each has a recommended answer.

| # | Issue | Decision |
| --- | --- | --- |
| D1 | **CDN cache hits skip the function**, so a passphrase check inside `/api/*` handlers is bypassed for any cached response. Anyone with the URL gets cached Epic data. | Enforce the gate in **Vercel Routing Middleware** (`middleware.ts` at repo root, works with Vite), which runs *before* the cache. Handlers re-check as defence in depth. |
| D2 | Cached responses must not vary per user, or the cookie would fragment / leak. | API responses never contain per-user data. "Which rows are my follows" is computed client-side; the server only accepts explicit `accountIds` params. |
| D3 | Leaderboard entries carry **account IDs, not names**. 100 rows × up to 3 members = up to 300 lookups per page. | Resolve names server-side with Epic's bulk account lookup (≤100 IDs per call), memoised in function memory and folded into the cached leaderboard response. |
| D4 | Leaderboard cache TTL depends on window **state**, which depends on the event list. | `/api/leaderboard` looks the window up via the same cached events fetch (`lib/epic/events.ts`), derives state, then sets `s-maxage` accordingly. |
| D5 | Vercel Hobby caps functions per deployment (12). | Budget: `events`, `window`, `leaderboard`, `player`, `login`, `health`, `ics` = 7 (all in use since Phase 4). Shared code lives in `lib/`, not in `api/`. |
| D6 | Epic access tokens expire (~2 h, confirm in Phase 0). | Token cache stores `expiresAt`; re-mint at `expiresAt − 5 min`, on 401, or on cold start. |
| D7 | "Cumulative" leaderboards. | **Resolved in Phase 0:** cumulative boards are score locations, not windows, and the leaderboard endpoint doesn't serve them. F12 computes cumulative standings server-side by summing the event's session boards, capped to the top N. |
| D8 | Time zone. | All server data is UTC ISO strings. Formatting happens only in the browser via `Intl.DateTimeFormat` with the settings time zone (default `America/New_York`). No date library needed beyond small helpers. |
| D9 | Monorepo vs. single package. | Single package. Vite app in `src/`, Vercel functions in `api/`, shared code in `lib/` (imported by both — types only from the browser side). |
| D10 | Epic won't return another account's row or history: `teamAccountIds=` accepts only the caller's own team, and per-player endpoints return 403. | Players are found by **scanning in the browser** (`src/scan.ts`). It reads a board's pages through `/api/leaderboard?lite=1`, which is CDN-cached and skips names, a few at a time since D26, and stops once everyone is found. Ranked Cup sessions try the top tier first. Scans of final boards are kept in the browser for good; live ones for 5 minutes. Scans run only when you ask (Leaderboard → Find on all pages, Me → Check), and only the top 10,000 are reachable, like Fortnite Tracker. |
| D11 | Schedule responses need `region=`, are about 1.2 to 1.9 MB each, and overlap: a region lists every event visible to it, and NAE has no events of its own. | `/api/events?region=X` makes **one** Epic call, because the response already holds everything visible in X. The route trims the response to `EventInfo` and takes the home region from the ID suffix; cards tag events from another home region. Combining regions (calendar, search) de-duplicates by `eventId`. Ranked cups use the main window board, not the per-tier boards. |
| D12 | Browsers honour `stale-while-revalidate`, so a CDN-style `Cache-Control` let a signed-out browser show cached API data. | API responses send `Cache-Control: private, no-store` to the browser, and configure Vercel's CDN separately with `Vercel-CDN-Cache-Control`. Vercel consumes that header and never forwards it. Session state is computed in the browser from the times, so a cached schedule never shows a stale "live". |
| D13 | Vercel compiles each function file without bundling, so Node's ESM rules apply. | Relative imports in `api/`, `lib/` and `middleware.ts` use explicit `.js` extensions. `npm run smoke:api` compiles them and loads them with bare Node in CI, and fails with `ERR_MODULE_NOT_FOUND` if one is missing. |
| D14 | A session can have several boards: the main board, one per Ranked Cup tier, and an FNCS cumulative board. Ranked Cup main boards carry no points (Phase 2 finding). | `/api/window` lists a session's boards, with scoring and payouts in plain terms. `/api/leaderboard` takes `board=`, and defaults to the main board if it scores, else the top tier. The UI hides unscored boards and remembers your tier. `board=cumulative` sums the top 300 of each session (D7) and says when lower ranks are approximate. |
| D15 | The leaderboard and window routes need window times and scoring rules from the schedule. | The raw schedule document is kept per warm function instance for 15 minutes (`lib/epic/schedule.ts`), shared with `/api/events`, so a board request costs one Epic call. Display names are kept for 24 hours (`lib/epic/accounts.ts`). |
| D16 | Opening an event should land on results, not a schedule (design overhaul). Epic's event and session IDs end in the region (`…_EU`). | The event page opens the latest session's board: a live one (latest start) first, else the one that ended last (`latestWindow()` in `lib/status.ts`); before any session starts it opens the session list. Session and region pickers switch in place. Another region's copy is the same ID with the suffix swapped (`src/links.ts`); NAE is offered only when a NAE copy exists (D11). |
| D17 | Cutoff lines (F16) have to come from payout tables, which mix cash, qualification tokens and cosmetics, by rank, top percentage or points. Points tiers at 0 are entry and lockout tokens every player gets. | `BoardInfo.cutoffs` (`parseCutoffs()` in `lib/epic/scoring.ts`) draws one line per next round at its furthest qualifying tier, one at the last paid place, one at the last place that wins a skin (outfit), and one per other item tier, skipping 0-point tiers. Cosmetics get plain names (Skin, Back Bling, Pickaxe, Glider, Emote, Wrap, Style). The browser places percentile lines from the team count (exact once the last page is loaded); a full board (100 pages) doesn't say how many teams there are, so those lines are left out. Qualifying and paid lines get a summary with the points the line takes now, or took. |
| D18 | Full depth (F14) means many loaded pages, but refreshing all of them every tick would multiply Epic calls. | Each tick re-reads page 0, the loaded pages on screen, pages holding a follow, and the pages a qualifying or paid line falls on, read in `lite` mode when they aren't loaded: at most 5 full and 3 lite pages (`src/useBoard.ts`). Other pages load as you scroll or jump, and stay as they were. Pinned rows off the loaded pages (F18) come from the last search of all pages, which a live board repeats every 5 minutes, starting around the pages where they were last found, once you've searched once (D10). |
| D19 | Movement arrows (F15) that compare with the previous fetch vanish whenever a refresh brings no change (Epic hasn't updated, or the CDN served the same copy). | A row's baseline is the newest earlier sighting of that team on any page, and a refresh where nobody moved keeps the old baseline (`src/movement.ts`). The ranks last shown are kept per board in localStorage (4 boards, 6 pages each), so arrows also cover the time since you last looked, and are dropped once the session is final. |
| D20 | The plan named `vite-plugin-pwa` for F34, but its `workbox-build` peer brings Babel, Rollup and Terser to emit a ~50-line worker, and npm 10 already struggles with peer dependencies here. | A hand-written worker (`pwa/sw.js`) with the build's file list and a version filled in by a small Vite plugin in `vite.config.ts`. Navigations go network first, with the saved shell offline; hashed assets come from the cache; `/api/*` is never cached or handled. It is registered in production builds only. |
| D21 | Calendar apps can't send the session cookie, but the feed (F5) must stay behind the gate, CDN cache included (D1). | `/api/ics?token=…&region=` is unlocked by its own secret, `ICS_TOKEN` (16+ characters; unset turns the feed off). Middleware checks it before the cache and the route checks it again; the token opens the feed only. The signed-in app reads the token from `/api/ics` without one (cookie-gated, `no-store`) to build the subscribe link: the one credential the browser sees, and only your own feed's. One event per session from two weeks back, with stable UIDs, cached 15 min. |
| D22 | Search (F8) and an all-regions calendar (F4) need every region's schedule; loading eight on every visit would waste calls. | `useAllEvents()` fetches the eight regions only while you search or pick "All regions", through the same CDN-cached `/api/events` and the browser's short cache, and lists each event once (D11). |
| D23 | Prize money (F23) needs the board's payout tiers for every result, but results come from scans saved over the season. | `PayoutTier` gains its `table` and `usd`. Scans now store their board's tiers; older saved scans get them from `/api/window` once, a few per visit. Within a table a place earns its nearest tier at or after it (6th in "1st…5th, 8th" gets the 8th-place prize); points tiers all pay once reached; 0-point entry tokens aren't prizes. Percentile tiers need the team count, so they count only where it's known. |
| D24 | The plan named Recharts for charts (F29). | Charts are small hand-drawn SVGs (`components/Charts.tsx`), like the icon set: one series each, measured to the container's pixel width, thin marks, hairline grid, the extreme labelled, tooltips on hover and keyboard focus, and a table beside every chart. A trend's axis fits its values; a fill is drawn only from zero. |
| D25 | Cutoff history (F28) costs Epic calls per finished session. | Read on request, one session at a time: the session's rules (`/api/window`), then one lite page per qualifying or paid rank line. Final standings don't change, so results are kept in the browser for good. Points lines aren't read (their name says what they take). Shown per event (Sessions tab) and for every event of a type in your region (Events → Cutoffs). |
| D26 | Fortnite Tracker finds anyone in the top 10,000 at once because it keeps its own copy of every board. This app has no database and reads Epic on demand. | Board pages are read **four at a time** with retries on rate limiting (`src/boardIndex.ts`), and the Epic client spaces calls 250 ms apart (was 1 s), so a cold search of 100 pages takes roughly 15 to 25 s on one function instance, and CDN-cached pages come back at once. Lite pages read this visit are kept in memory (final boards for the visit, live ones for a minute, the last 4 boards), so a second search on the same board, another follow, or a Me check reads nothing new. **Find a player** on the leaderboard turns an exact Epic name into an account ID (`/api/player?name=`), then reads the board until that player turns up and jumps there. Epic's rate limit is still untested (`EPIC_API_NOTES.md`); if searches start failing with "rate limiting", raise the spacing back toward 1 s. |
| D27 | Opens and finals look the same: every session's round type is "Qualifiers". | Each session gets a `stage` from its entry tokens (`windowStage()` in `lib/epic/events.ts`). No token (region locks and `fake_token` don't count) is **Open**. A token is needed and the session's own rewards qualify players onward: **Qualified** (heats, last-chance lobbies). A token is needed and nothing comes after it: **Final**. The stage shows as a tag on the event page, the session picker and list, Home, the calendar agenda and search results. |
| D28 | Per-match stats (Fortnite Tracker's match pages) need each game's lobby, which Epic doesn't serve. | Every game in a team's history carries Epic's match ID (`sessionId`), shared by the teams that played it, and its time alive (`TIME_ALIVE_STAT`, seconds). `src/matches.ts` rebuilds games from board rows. A session is a set lobby when its games hold at least 8 of the page's teams on average; there, teams that shared games are grouped into lobbies, and each game shows every team's place, eliminations, points and time alive. Qualified and Final sessions get a **Matches** tab that reads the board's first 5 pages (up to 20 on request) and refreshes them on the board's schedule while live. A team's games open the game in place; in an open session that lists only the teams on loaded pages, since the rest of its lobby is spread across the board. |
| D29 | In qualified rounds and finals what matters is where a team stands as the games go, not points per game. Epic only gives each team's own games. | Lite leaderboard rows keep each game's points (`gamePoints`; they add up to Epic's total in the captures). On Qualified and Final sessions, and every Performance Evaluation session (Epic's own round numbers are unreliable: Cash Cup rounds are all 0), opening a team reads every page of the board once (lite, four at a time, D26) and charts the team's **placement after each game**, with a Rank column in its games table (`src/placements.ts`). After game k every team counts its first k games, which in a set lobby is the board after each match. Ties share the better rank. Final boards are read once per visit; live ones again after 2 minutes. Open sessions keep points per game. Rank axes switch from powers of ten to whole-number steps when the ranks are close together. |
| D30 | Me should fill itself without board scanning, but Epic answers questions about an account only when that account is signed in (D10), and keeping your main account signed in on the server would put a permanent login to it at risk. | **Sync with Epic** (Me) signs in on demand with Epic's device code flow: you open epicgames.com, sign in and approve, so no password passes through the app. The sign-in is exchanged into the app's client (as for the service account) and lives only in a sealed cookie: AES-GCM with a key from `COOKIE_SECRET`, `HttpOnly`, `Path=/api/sync`, 15 minutes (`lib/auth/seal.ts`). The server stores nothing, and the browser can't read it. Your results come from Epic's per-player history, `GET /api/v1/events/Fortnite/{eventId}/history/{yourId}`: one call per event lists a score (shaped like a leaderboard entry, with a `scoreKey` naming its board) for every session you played in it, with your rank and team, whatever team you played in. It answers only for the signed-in account (Phase 0's 403 for another account named the permission, `Fortnite:profile:<id>:commands READ`). `step=history` asks about 12 events per request, four calls in flight, 16 Epic calls at most; if Epic wants a team named (400) it asks again with just you. The browser asks about every event this season with a finished session not yet settled for you, in **every** region (you can play outside yours), your region's first; a repeat sync only asks about events with new finished sessions. A Ranked Cup's standing is on its tier boards (D14): when the history only has a session's main board, that session is read with `step=rows` and `teamAccountIds=` your whole team from the history, main board first, then tiers top first, 8 sessions per request. Two earlier attempts didn't work: your schedule's `player.teams` isn't a history (the first real sync: it listed one session, not the ones played), and boards filtered to just you miss team modes (the second: 1 result from 60 sessions; your duos Ranked Cup and anything past the newest 60 of your region's sessions were missed). When the sync ends, whether it finishes, fails, is cancelled or the page closes, the browser calls `DELETE /api/sync`, which ends the session at Epic. Results are kept like final board searches. Up to three results a board search found are checked against the history (shown in the details). The history lists every session you played in an event, so the event's other finished sessions count as not played and leave the list to check, but only in team sizes the history has listed a session for in this sync, only if no score in the event failed to match a board, and only if every check held. If Epic forbids the history for every event in the first request, the sync stops asking. The signed-in account becomes your "me" follow, and **What Epic returned** on the panel lists your schedule download's outline (including its `scores` count), each event's sessions with your rank, Epic's refusals, and the checks. This is the one per-user API route, so it's never cached (an exception to D12). It needs `EPIC_DEVICE_CODE_CLIENT_ID` and `EPIC_DEVICE_CODE_CLIENT_SECRET` on the server. Still to confirm with a real sync: the history's shape and that its ranks match the boards (`EPIC_API_NOTES.md`). |

---

## 2. Repository layout

```
YosikReboot/
├── CLAUDE.md                     # Short handoff for AI-assisted sessions
├── docs/
│   ├── DEVELOPER_PLAN.md         # Product spec (source of truth for scope)
│   ├── IMPLEMENTATION_PLAN.md    # This file
│   └── EPIC_API_NOTES.md         # Phase 0 output: verified shapes, quirks
├── scripts/                      # Local-only tools (Phase 0 probe, device-auth setup); never deployed
├── middleware.ts                 # Passphrase gate (D1)
├── vercel.json                   # SPA rewrites, function config
├── api/                          # One file = one Vercel Function
│   ├── events.ts                 # GET ?region=
│   ├── window.ts                 # GET ?window=
│   ├── leaderboard.ts            # GET ?window=&page=
│   ├── player.ts                 # GET ?name= | ?id=
│   ├── login.ts                  # POST {passphrase} → Set-Cookie
│   ├── sync.ts                   # POST ?step=start|poll|history|rows, DELETE: Sync with Epic, your own sign-in (D30)
│   ├── health.ts                 # GET token + upstream status
│   └── ics.ts                    # GET ?token=&region= calendar feed (D21)
├── lib/                          # Server-only unless noted
│   ├── types.ts                  # Event, Window, Entry … (shared with browser)
│   ├── status.ts                 # windowState(), cacheSecondsFor() (shared)
│   ├── auth/
│   │   ├── cookie.ts             # HMAC sign/verify for the session cookie
│   │   ├── seal.ts, deviceCode.ts   # sealed cookie values; the "open this link and approve" sign-in (D30)
│   │   └── epicToken.ts          # Device-auth → access token, memoised
│   ├── epic/
│   │   ├── client.ts             # fetch wrapper: auth header, 250 ms spacing (D26), backoff, 401 retry
│   │   ├── endpoints.ts          # URL builders (one place to fix when Epic changes)
│   │   ├── events.ts             # raw → Event[]/Window[]
│   │   ├── leaderboard.ts        # raw → Entry[]
│   │   ├── accounts.ts           # name ⇄ id, bulk lookup, memo
│   │   ├── templates.ts          # scoring + payout tables
│   │   └── cms.ts                # tournamentinformation (posters, titles)
│   ├── http.ts                   # json(), cacheHeaders(), error envelope
│   ├── ics.ts                    # iCalendar text: folding, escaping
│   └── health.ts                 # in-memory ring buffer of recent upstream calls
├── pwa/sw.js                     # Service worker template; vite.config.ts fills in the build's files (D20)
├── public/                       # Web manifest and app icons (PNGs rendered from icons/icon.svg)
├── src/                          # Vite + React + Tailwind
│   ├── main.tsx, App.tsx         # router and the top bar; registers the service worker in production
│   ├── index.css                 # design tokens (dark default, light override), fonts
│   ├── api.ts, live.ts           # typed fetchers; live polling by window state
│   ├── useBoard.ts, board.ts     # a board's loaded pages and what refreshes (D18); rows, gaps, cutoffs, pins
│   ├── movement.ts               # movement arrows (D19)
│   ├── scan.ts, follows.ts, teams.ts, settings.ts, store.ts   # browser-side state (localStorage)
│   ├── boardIndex.ts             # pages read four at a time with retries; lite pages kept in memory (D26)
│   ├── matches.ts                # games and lobbies rebuilt from board rows (D28)
│   ├── placements.ts             # placement after each game from every team's game points (D29)
│   ├── sync.ts                   # Sync with Epic: sign in, read your rows, keep them, sign out (D30)
│   ├── theme.ts                  # System, Dark or Light (Settings), applied before paint by index.html
│   ├── csv.ts                    # CSV export
│   ├── search.ts, calendar.ts    # event search (F8); month and week grids (F4)
│   ├── prizes.ts, cutoffHistory.ts, scales.ts   # prize money (D23); cutoff history (D25); chart axes
│   ├── links.ts, format.ts       # event URLs and region suffixes; dates in your time zone
│   ├── components/
│   │   ├── ui.tsx                # primitives: tags, tabs, pills, buttons, panels, sheets, Art
│   │   ├── icons.tsx             # stroke icon set
│   │   ├── EventCard.tsx         # poster card, grid tile, compact row
│   │   ├── Board.tsx             # the leaderboard: refresh, depth, jump, cutoffs, side panel
│   │   ├── BoardRows.tsx         # rows, match breakdown, cutoff lines, gaps
│   │   ├── Pinned.tsx, BoardExport.tsx, Scoring.tsx   # pinned follows; CSV export; scoring and prizes
│   │   ├── CalendarView.tsx, SearchResults.tsx, Feed.tsx, CutoffHistory.tsx   # Events views; feed link
│   │   ├── PlayerView.tsx, Charts.tsx   # a player's season (Me and /players/:id); SVG charts (D24)
│   │   ├── MatchView.tsx, MatchesTab.tsx   # a team's games, one game's lobby, a session's games (D28)
│   │   ├── FindPlayer.tsx        # find anyone on a board by exact Epic name (D26)
│   │   ├── SyncPanel.tsx         # Sync with Epic on Me (D30)
│   └── pages/                    # Home, Events, EventPage, Me, Player, Follows, Settings, Health, Login
└── test/
    ├── fixtures/epic/            # Saved, scrubbed real responses from Phase 0
    └── *.test.ts                 # Vitest
```

**Rule:** nothing in `src/` parses Epic's raw format. The browser only sees the shapes in `lib/types.ts`.

---

## 3. Core types (`lib/types.ts`)

`lib/types.ts` is the source of truth. The browser only ever sees these shapes:
- `EventInfo` and `EventWindow`, served in `EventsResponse` from `/api/events`
- `HealthResponse`, served from `/api/health`

Phase 0 changed the original sketch in three ways:
- `mode` is `BR | RELOAD | OTHER`, with `zeroBuild` as a separate flag.
- Epic's "ShopCup" type is `PROMO_CUP`.
- Windows carry no `state`. `lib/status.ts` computes `windowState`, `eventState` and `nextWindow` from the times, in the browser (D12).

`Entry` and `LeaderboardPage` arrive in Phase 2. Phase 3 adds `Cutoff` to `BoardInfo` (D17).

## 4. Phases

Each phase ends with a deployed preview you can open, a commit, and a push. **MVP = end of Phase 2.**

### Phase 0 — Prove the data (spike, ~2–3 sessions)

Goal: replace every "not yet verified" line in the spec with facts and fixtures. No UI.

> **Status: done.** A live capture on 2026-10-21 answered the checklist; see [`EPIC_API_NOTES.md`](./EPIC_API_NOTES.md). It added D10 and D11 above and resolved D7. The anonymized fixtures are in `test/fixtures/epic/first/`.

Tasks
1. Create the secondary Epic account; generate device-auth credentials (`accountId`, `deviceId`, `secret`) via a one-off local script (`scripts/create-device-auth.ts`, never deployed). Store them in `.env.local` and Vercel env vars.
2. Script `scripts/probe.ts` that mints a token and hits each endpoint, writing scrubbed responses to `test/fixtures/epic/<label>/` and an `analysis.md` that answers the checklist below. Tokens and device credentials are never saved; responses still contain other players' IDs, so keep the repo private.
3. Answer and record in `docs/EPIC_API_NOTES.md`:
   - [ ] Token mint request/response, `expires_in`, refresh behaviour.
   - [ ] Does one `events/download` call return all regions, or is `region=` required? (Sets how `/api/events` fans out.)
   - [ ] Window fields actually present: `payoutDelay`, `round`, `blackoutPeriods`, `scoreLocations`, token requirements.
   - [ ] Where scoring/payout tables live (templates vs. window `scoringRuleSetId`/`payoutTableIdMap`).
   - [ ] Leaderboard: page size, total pages, entry shape (`teamAccountIds`, `rank`, `pointsEarned`, `sessionHistory[].trackedStats`).
   - [ ] Can we fetch a **specific account's row** (e.g. `teamAccountIds=` param) without scanning? (Decides F25 cost.)
   - [ ] Cumulative boards: separate window IDs or not (D7).
   - [ ] Bulk account lookup limit and rate behaviour.
   - [ ] Rough rate limit: how many calls/min before 429.
   - [ ] CMS `tournamentinformation` → how to join to event IDs (`displayDataId`?).
4. Capture fixtures for at least: an upcoming window, a live window (do this during a real session), a just-ended window, a final window, a duos event, and a 404/expired window.

**Gate 0:** every endpoint used in Phase 1–2 has a saved fixture and a documented shape. If the token flow or leaderboard endpoint is not workable, stop and switch the primary source to the fortnite.com/competitive fallback before building UI.

### Phase 1 — Skeleton, gate, schedule (~3–4 sessions)

Goal: a deployed, passphrase-protected app that lists every region's events in Eastern time.

Features: F1, F2, F3, F6 (basic), F7, F32, F33 (baseline), F35, F36, F37 (server side).

> **Status: done** (code), pending one check in production by you, listed below.
> - Built: the passphrase gate (`api/login.ts`, `middleware.ts`), the Epic client with token reuse, 401 retry, call spacing and a call log, the schedule parser and classifiers, `/api/events`, `/api/health`, and the pages (login, home, events with tabs and filters, event detail, settings, health).
> - Verified locally against live Epic data through `npm run dev`, which runs the real routes and middleware:
>   - All 8 regions load (NAC 50 events, NAE 32, NAW 50, EU 29; BR, OCE, ME and ASIA 28 each).
>   - Signed-out requests get 401, including for a URL that was just fetched.
>   - Sign-out takes effect immediately.
>   - The layout has no horizontal scroll at 390 px, in light or dark mode.
> - Not verifiable here: fortnite.com's own schedule (blocked in the build sandbox), so times were checked against Epic's raw UTC timestamps instead.
>
> **Production check (yours):** sign in on the deployed app and open Events, then Settings → API health; the status should read OK. Optionally, `curl -sI https://<your-app>/api/events?region=NAE` should answer 401.

Tasks
1. ~~**Scaffold:** Vite + React + TS + Tailwind + React Router; ESLint, Prettier, Vitest; `vercel.json` with SPA fallback; deploy an empty page to Vercel Hobby.~~ Done.
2. ~~**Gate (D1):** `api/login.ts` compares the passphrase (constant-time) to `APP_PASSPHRASE`, sets `yr_session` = HMAC(`COOKIE_SECRET`, issuedAt) — `HttpOnly; Secure; SameSite=Strict; Max-Age=30d`. `middleware.ts` verifies it for every `/api/*` path except `/api/login`, returning 401. The SPA shows `/login` on 401. No CORS headers anywhere.~~ Done.
3. ~~**Epic client:** `epicToken.ts` (D6), `client.ts` (bearer header, ≥1 s spacing between calls within an instance, one retry on 401 after re-mint, typed `UpstreamError` on 429/5xx), `endpoints.ts`.~~ Done.
4. ~~**Parsers:** `epic/events.ts` + `cms.ts` with fixture tests. Classification helpers `classifyType()` / `classifyMode()` / `teamSize()` from event IDs and CMS text — table-driven tests, since these are heuristics.~~ Done.
5. ~~**`/api/events?region=`:** fetch, normalise, attach CMS display data (CMS cached 24 h in memory), compute `state`, `Cache-Control: public, s-maxage=900, stale-while-revalidate=60`.~~ Done, with D11 and D12 applied: one Epic call per region, no server-side `state`, CDN-only caching.
6. ~~**`/api/health`:** token status (minted at, expires at, last error), last 20 upstream calls from the ring buffer, `consecutiveFailures` (≥3 = red). `Cache-Control: no-store`.~~ Done.
7. ~~**Frontend:** `Settings` store (region, tz, refresh interval) → `RegionSwitcher` in the header → `/events` with Upcoming/Live/Ended tabs and filter chips → `/events/:eventId` showing windows grouped by round with `Countdown`. Mobile-first layout from the start.~~ Done.

**Acceptance**
- Wrong/no cookie → every `/api/*` returns 401, including a URL that was just cached (test with `curl` after a logged-in fetch).
- All eight regions load; times match fortnite.com's schedule converted to ET.
- Unit tests pass on fixtures with no network.

### Phase 2 — Live leaderboards, follows, me (MVP) (~4–5 sessions)

Goal: open a live board during a real session, watch it refresh, find yourself and your follows.

Features: F10, F11, F12, F13, F22, F25, F37 (client side), Home page, F6 completed (scoring if available).

> **Status: done** (code), pending your check on a real live session in production.
> - **Built:**
>   - `/api/leaderboard` (boards, cumulative, `lite`), `/api/window` and `/api/player`
>   - scoring and payout parsing, plus per-match points
>   - the live refresh hook, the leaderboard page (tier tabs, search, match details, load more, scoring panel, follows strip)
>   - Follows (add by name, mark yourself, export/import), Me (check sessions, results list, trend) and a follows section on Home
>   - the browser-side scanner
> - **Verified locally against live Epic data** (scripted Chromium at 390 px):
>   - A live board refreshed once in 70 s, not at all in 70 s hidden, and once on return.
>   - Wrapping-up and final boards get the right CDN lifetimes (5 min, 24 h).
>   - Ranked Cup tier tabs work.
>   - A "Check" on Me found the test account 1st on the Unreal board in one page.
> - **Not verifiable locally:** that Vercel's CDN holds Epic calls to one per board page per 30 s. The headers are tested, but the dev server has no CDN. Check `/api/health` in production during a live session.

Tasks
1. ~~**`/api/leaderboard?window=&page=`:** state lookup (D4) → Epic page → `epic/leaderboard.ts` normaliser → bulk name resolution (D3) → `s-maxage` from `cacheSecondsFor(state)`. Optional `&accountIds=a,b` mode (D10: implemented by scanning, not by an Epic filter) returns just those teams' rows (implementation depends on Phase 0 finding; fallback is "scan pages, stop when all found", only allowed for `final` windows and cached 24 h).~~ Done.
2. ~~**`/api/window?window=`:** template → scoring, payouts, cutoffs. Cached 24 h.~~ Done.
3. ~~**`useLiveQuery`:** interval from `refreshMsFor(state)`; pauses on `visibilitychange` hidden, fires once on visible; backoff 2 → 4 min on errors with a "Stale since hh:mm" banner; resets on success; exposes `fetchedAt` for the "updated 12 s ago" stamp.~~ Done.
4. ~~**Leaderboard page:** sticky header (name, region, `StatusBadge`, updated stamp), session/cumulative toggle (D7), name search (current page client-side; "find across pages" button uses `accountIds` lookup if a follow, else pages forward), virtualised list for long pages.~~ Done, with board tabs (D14) and "load more" instead of a virtualised list, since full-depth scrolling is F14 in Phase 3.
5. ~~**Follows (`/follows`):** add by Epic name → `/api/player?name=` → store `{ id, label, isMe }` keyed by ID; export/import JSON with schema version.~~ Done.
6. ~~**`/api/player`:** name⇄id; season results = for each ended window in the cached event lists, find the account's row (by scanning, per D10), cached 24 h per window.~~ Done as a name/ID lookup; results scanning moved to the browser (D10).
7. ~~**`/me` and Home:** Home = live-now list, next three sessions, follows' current rank in any live window they appear in. `/me` = your season results table + a simple placement trend line.~~ Done.

**Acceptance (Gate 2 / MVP)**
- During a real live session on a phone: the board refreshes ~every 60 s, pauses when the screen locks, and `/api/health` shows ≤1 Epic leaderboard call per 30 s per page regardless of how many tabs are open.
- After the window ends, the badge moves to "wrapping up", refresh slows to 5 min, then "final" stops refreshing.
- Your own results for this season appear on `/me`.

### Design overhaul (between Phases 2 and 3)

> **Status: done** (code), pending your look on a phone.
> - **Look:** dark, poster-led, electric violet accent, top bar navigation, compact leaderboards. Barlow Condensed for headings, Manrope for text, both self-hosted. Light mode follows the system.
> - **Art:** the CMS backgrounds, 16:9 tiles, square posters and event colors now reach the browser (`EventInfo.art`). Epic's image CDN resizes them on request (`?resize=1&w=`), so a thumbnail is a few KB.
> - **Event page (D16):** one page per event with an art hero, then Leaderboard, Sessions, and Rules & prizes tabs. It opens on the most recent session's board. Session and region pickers switch in place.
> - **Pages:** Home (live posters, starting soon, just finished, follows), Events (tabs, filters, art tiles in Today / Tomorrow / This week / Later), Me (stats, trend, art thumbnails), Follows, Settings, Health, and a branded sign-in page.
> - **Fixed on the way:** the scoring summary stopped counting eliminations at a multiplicative tier's key, so every Ranked Cup tier read "up to 1 elimination". It now counts to 100 (fixture test added).
> - **Verified locally** against live Epic data in scripted Chromium at 390 px and 1366 px, dark and light, with no horizontal scroll and no console errors:
>   - an ended event opened on its last session's board (100 rows)
>   - a Ranked Cup opened on the remembered tier
>   - a region switch landed on the same session in EU
>   - an event with no started sessions opened on its session list
>   - a followed player was highlighted on the board and found by Check on Me

### Phase 3 — v1 leaderboard depth (~4 sessions)

Features: F14, F15, F16, F17, F18, F21, F24, F31, F34.

> **Status: done** (code), pending your checks on a phone during a live session.
> - **Built:**
>   - Full depth: pages load as you scroll, a rank box jumps anywhere in the top 10,000, and gaps between loaded pages can be filled from either side. What refreshes is in D18.
>   - Movement arrows, including "new" for teams that just reached a page (D19).
>   - Cutoff lines in the board, and a summary of the qualifying and paid lines with the points they take now or took (D17). Tap a summary to jump to its line.
>   - Pinned follows and saved teams above the board, wherever they rank. Tap one to jump to its row. A live board repeats your last search every 5 minutes.
>   - Teams: save a duo or trio from a board row or the Follows page. Saved teams are labelled on boards, pinned, and exported and imported with your follows (export format version 2).
>   - Scoring and prizes beside the board on desktop, and in a sheet on phones.
>   - CSV export of the loaded rows, of every page once a session is final, and of your results on Me.
>   - Installable app: manifest, icons and an app-shell service worker (D20).
> - **Verified locally** in scripted Chromium at 390 px and 1366 px, dark and light, with no horizontal scroll and no console errors. The build sandbox has no Epic credentials, so the real API routes ran against a fake Epic that serves the captured schedules and CMS and generates boards whose ranks drift every 30 s:
>   - On a live FNCS Last Chance board, arrows appeared after a refresh (86 of 100 rows moved), and the Top 22 and 1,000-point lines showed with their current points.
>   - Find on all pages pinned three follows at ranks 167, 278 and 2,003. Tapping the 2,003rd jumped to it, and scrolling loaded three more pages.
>   - A finished Cash Cup round drew Top 20 qualify (with the points it took) and pinned a saved duo at 1,571. Export of every page wrote 10,000 rows.
>   - A Ranked Cup tier drew its Top 6 and percentile lines.
>   - The production build's service worker cached 20 shell files and nothing under `/api/`, and the app opened offline.
> - **Your checks:** during a real live session on a phone, the arrows move, the cutoff summary matches the board, and `/api/health` stays polite with a deep page open. Then add the app to your home screen.


- **F14 Full depth:** infinite scroll fetching subsequent pages only on scroll; jump-to-rank input.
- **F15 Movement:** `store/lastBoard` saves `{teamKey → rank}` for the visible page + follows per window; diff on each refresh; cleared when the window is final.
- **F16 Cutoff line:** from `WindowDetail.cutoffs`; points taken = the entry at that rank (fetch that single page if needed).
- **F17 Match breakdown:** expand row → `entry.sessions` (already in payload).
- **F18 Pinned follows:** strip above the list via `accountIds` mode. Live windows rescan at most every 5 min (D10); rows on pages already loaded update every tick.
- **F21 Scoring panel:** side panel on desktop, bottom sheet on phone.
- **F24 Team grouping:** `teamKey` = sorted member IDs; follows can be grouped into named teams.
- **F31 CSV export:** client-side from loaded pages (and "export all" that walks pages for final windows only).
- **F34 PWA:** manifest + app-shell cache (never cache `/api/*` in the service worker — Epic data must stay fresh). Built without `vite-plugin-pwa` (D20). Dark mode shipped with the design overhaul.
- F17 (match breakdown) shipped in Phase 2: tap a row.

### Phase 4 — v1 schedule & history (~3–4 sessions)

Features: F4, F5, F8, F23, F28, F29.

> **Status: done** (code), pending your checks in production.
> - **Built:**
>   - Calendar (Events → Calendar): month grid (dots on phones, session names wider), the day's sessions below it, and a week agenda; your region or all regions.
>   - Calendar feed: `/api/ics` behind its own token (D21), with a subscribe link on the calendar and in Settings.
>   - Search across every region (Events page): events, sessions and dates, typo-tolerant, with sessions picked out ("round 2", "oct 18").
>   - Player pages (`/players/:id`, and Me): results, best finish, prize money and qualifications from payout tables (D23), placement over time, and each result's points per game. Players link from Follows, Home and board rows.
>   - Points per game (F29) on player results and in a board row's breakdown.
>   - Cutoff history (D25): per event on its Sessions tab, and by type in your region under Events → Cutoffs, as a table and a chart.
> - **Verified locally** in scripted Chromium at 390 px and 1366 px, dark and light, with no horizontal scroll and no console errors, against a fake Epic serving the captured schedules and CMS with generated boards (no Epic credentials in the build sandbox):
>   - "cash cup round 2" found 7 events across regions, each with only its Round 2 sessions.
>   - The calendar showed today and session states, a day's agenda, the week, and 157 sessions across all regions. The subscribe sheet built the feed link, and Python's `icalendar` parser read all 76 sessions of the NAE feed.
>   - Cutoff history read every finished Reload Cash Cup session (Top 20 qualify around 600 points, Top 5 paid) into a table and chart.
>   - Checking Cash Cup sessions on Me found 2 results: a 3rd place worth $300 (from the payout table) and a 113th. Opening a result drew its points per game with tooltips.
> - **Your checks:** set `ICS_TOKEN` in Vercel (16+ characters, `openssl rand -hex 16`), redeploy, then subscribe from Settings and see sessions in your calendar app. Then try Me → Check on your own sessions.

- **F4 Calendar:** month/week grid built from all regions' windows (or current region; setting).
- **F5 iCal feed:** `api/ics.ts` → `text/calendar`. Calendar apps can't send cookies, so this route uses a **separate secret token in the query string** (`ICS_TOKEN`), excluded from the cookie middleware and checked in middleware instead. Cache 15 min.
- **F8 Search:** client-side fuzzy match over all regions' cached event lists.
- **F23 Player page:** season history, best finishes, earnings from payout tables.
- **F28 Cutoff history:** for each ended window, points at each cutoff rank (one page fetch per cutoff, kept in the browser for good, D25). Group by event type × region.
- **F29 Points charts:** points per game for a team, drawn without a chart library (D24).

### Updates after Phase 4

> **Status: done** (code), pending your checks in production.
> - **Theme:** Settings → Theme picks System, Dark or Light. Dark stays the default look; the choice applies before the page paints, so there's no flash.
> - **Skin lines:** boards draw a line at the last place that wins a skin, in gold, with its points in the summary and in cutoff history (D17).
> - **Opens and finals:** every session is tagged Open, Qualified or Final (D27).
> - **Per-match stats:** a team's games list place, eliminations, points and time alive, and each opens that game. Qualified and Final sessions have a Matches tab: every lobby's games in order, each with every team's result (D28).
> - **Faster searches and Find a player:** pages are read four at a time and kept for the visit, and the leaderboard search finds anyone in the top 10,000 by exact Epic name (D26).
> - **Sync with Epic:** Me signs in with your own account on demand (you approve on epicgames.com), reads Epic's history of your results in every event this season, in every region, keeps the results, and ends the Epic session; nothing is stored on the server (D30).
> - **Placement after each game:** in Qualified and Final sessions and Performance Evaluations, a team's breakdown charts where it stood on the board after each game, instead of points per game, and its games table gains a Rank column (D29).
> - **Verified locally** in scripted Chromium at 390 px and 1366 px, dark and light, with no horizontal scroll and no console errors, against the fake Epic (now with set lobbies, match IDs and 300 ms per Epic call):
>   - The theme switched to Light, survived a reload, and set the browser bar color.
>   - The Last Chance Lobby showed Qualified, opened a game from a team's row, then listed 6 lobbies and 36 games. Reading every team filled each lobby to 100; a game showed all 100 players with Game 2 and Game 4 links.
>   - Find a player found someone at #5,822 of 10,000 in 16.5 s from cold, and a second player on the same board in 0.7 s.
>   - Diamond tier showed its Top 4 skin line.
> - **Your checks:** open a live final or heat and its Matches tab, and try Find a player with a friend's exact Epic name. If searches report rate limiting, slow the spacing back down (D26). For Sync with Epic, add `EPIC_DEVICE_CODE_CLIENT_ID` and `EPIC_DEVICE_CODE_CLIENT_SECRET` to Vercel (the same values as in `.env.local`), redeploy, then Me → Sync with Epic; check the results against the Compete tab.

### Later (not scheduled)

- Staying signed in to your main account permanently (stored device auth, so Me syncs with no approval) was considered and isn't recommended: the secret is a full login that skips two-factor, and a leak would expose your real account. Sync with Epic (D30) signs in on demand instead.
- F9 eligibility (needs the player-tokens endpoint working for *your* account, not the service account), F19 projected cutoff and F20 points calculator (build on F28 data), F26 head-to-head, F27 replay stats via api-fortnite.com, F30 Power Rankings scraper.

---

## 5. Cross-cutting concerns

**Testing**
- Unit: `status.ts`, all `epic/*` normalisers, classifiers, cookie sign/verify — against fixtures. Target: every parser branch covered.
- API: handler tests with the Epic client mocked by fixtures (assert status, headers, especially `Cache-Control`).
- Contract canary: `scripts/probe.ts --check` re-fetches live data and validates it against the same zod schemas the parsers use; run manually or from a weekly GitHub Action to catch Epic changes early.
- Manual: one live-session checklist per phase that touches leaderboards.

**Validation of upstream data:** parse Epic responses with `zod` (`.passthrough()`), so unknown fields don't break us but missing required ones fail loudly and show up on `/api/health`.

**Error envelope:** every API error returns `{ error: { code, message, upstreamStatus? } }` with a matching HTTP status; errors are `Cache-Control: no-store` so a failure is never cached for 24 h.

**Environment variables**

| Name | Used by |
| --- | --- |
| `EPIC_ACCOUNT_ID`, `EPIC_DEVICE_ID`, `EPIC_DEVICE_SECRET` | `epicToken.ts` |
| `EPIC_CLIENT_ID`, `EPIC_CLIENT_SECRET` | OAuth client for the device-auth grant |
| `EPIC_EVENTS_CLIENT_ID`, `EPIC_EVENTS_CLIENT_SECRET` | Optional second client to exchange into, only if Phase 0 shows it's needed |
| `EPIC_DEVICE_CODE_CLIENT_ID`, `EPIC_DEVICE_CODE_CLIENT_SECRET` | The "open this link and approve" sign-in: the setup tool, and Sync with Epic (D30) |
| `APP_PASSPHRASE` | `api/login.ts` |
| `COOKIE_SECRET` | cookie HMAC |
| `ICS_TOKEN` | Phase 4 iCal feed |

**Politeness budget (F37):** server-side spacing + CDN cache + client pause-when-hidden. `/api/health` shows upstream calls per minute so this is observable, not assumed.

**Security checklist:** no secrets in the bundle (CI greps the build output for env var names), `HttpOnly` cookie, middleware gate covers cached responses, no CORS, the iCal token is the only query-string secret, opens only the feed, and is rotatable (D21). Your own Epic sign-in (D30) is never stored: it rides in a sealed `HttpOnly` cookie scoped to `/api/sync` for at most 15 minutes, and is ended at Epic when the sync ends.

---

## 6. Milestone summary

| Phase | Ships | Features | Gate |
| --- | --- | --- | --- |
| 0 | Fixtures + `EPIC_API_NOTES.md` | — | Endpoints verified, or switch to fallback |
| 1 | Gated app with 8-region schedule | F1–3, F6, F7, F32, F33, F35–37 | Cached responses still gated |
| 2 | **MVP**: live boards, follows, `/me` | F10–13, F22, F25 | Survives a real live session |
| 3 | Leaderboard depth, PWA | F14–18, F21, F24, F31, F34 | — |
| 4 | Calendar, iCal, history, charts | F4, F5, F8, F23, F28, F29 | v1 complete |
| Later | Analytics & extras | F9, F19, F20, F26, F27, F30 | — |

## 7. Open questions carried from the spec

The plan assumes the first option for each; none block Phase 0–1.

- Follow list contents and your Epic display name — needed before Phase 2 testing.
- Live depth: top 500 vs. 10,000 — Phase 2 ships "visible page only"; Phase 3 adds full depth either way.
- Follow sync across devices — export/import only; real sync would require storage and is out of scope under "no database".
