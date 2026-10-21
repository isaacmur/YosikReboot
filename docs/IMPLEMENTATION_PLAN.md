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
| D5 | Vercel Hobby caps functions per deployment (12). | Budget: `events`, `window`, `leaderboard`, `player`, `login`, `health`, later `ics` = 7. Shared code lives in `lib/`, not in `api/`. |
| D6 | Epic access tokens expire (~2 h, confirm in Phase 0). | Token cache stores `expiresAt`; re-mint at `expiresAt − 5 min`, on 401, or on cold start. |
| D7 | "Cumulative" leaderboards. | **Resolved in Phase 0:** cumulative boards are score locations, not windows, and the leaderboard endpoint doesn't serve them. F12 computes cumulative standings server-side by summing the event's session boards, capped to the top N. |
| D8 | Time zone. | All server data is UTC ISO strings. Formatting happens only in the browser via `Intl.DateTimeFormat` with the settings time zone (default `America/New_York`). No date library needed beyond small helpers. |
| D9 | Monorepo vs. single package. | Single package. Vite app in `src/`, Vercel functions in `api/`, shared code in `lib/` (imported by both — types only from the browser side). |
| D10 | Epic won't return another account's row or history: `teamAccountIds=` accepts only the caller's own team, and per-player endpoints return 403. | Players are found by **scanning in the browser** (`src/scan.ts`). It reads a board's pages one at a time through `/api/leaderboard?lite=1`, which is CDN-cached and skips names, and stops once everyone is found. Ranked Cup sessions try the top tier first. Scans of final boards are kept in the browser for good; live ones for 5 minutes. Scans run only when you ask (Leaderboard → Find on all pages, Me → Check), and only the top 10,000 are reachable, like Fortnite Tracker. |
| D11 | Schedule responses need `region=`, are about 1.2 to 1.9 MB each, and overlap: a region lists every event visible to it, and NAE has no events of its own. | `/api/events?region=X` makes **one** Epic call, because the response already holds everything visible in X. The route trims the response to `EventInfo` and takes the home region from the ID suffix; cards tag events from another home region. Combining regions (calendar, search) de-duplicates by `eventId`. Ranked cups use the main window board, not the per-tier boards. |
| D12 | Browsers honour `stale-while-revalidate`, so a CDN-style `Cache-Control` let a signed-out browser show cached API data. | API responses send `Cache-Control: private, no-store` to the browser, and configure Vercel's CDN separately with `Vercel-CDN-Cache-Control`. Vercel consumes that header and never forwards it. Session state is computed in the browser from the times, so a cached schedule never shows a stale "live". |
| D13 | Vercel compiles each function file without bundling, so Node's ESM rules apply. | Relative imports in `api/`, `lib/` and `middleware.ts` use explicit `.js` extensions. `npm run smoke:api` compiles them and loads them with bare Node in CI, and fails with `ERR_MODULE_NOT_FOUND` if one is missing. |
| D14 | A session can have several boards: the main board, one per Ranked Cup tier, and an FNCS cumulative board. Ranked Cup main boards carry no points (Phase 2 finding). | `/api/window` lists a session's boards, with scoring and payouts in plain terms. `/api/leaderboard` takes `board=`, and defaults to the main board if it scores, else the top tier. The UI hides unscored boards and remembers your tier. `board=cumulative` sums the top 300 of each session (D7) and says when lower ranks are approximate. |
| D15 | The leaderboard and window routes need window times and scoring rules from the schedule. | The raw schedule document is kept per warm function instance for 15 minutes (`lib/epic/schedule.ts`), shared with `/api/events`, so a board request costs one Epic call. Display names are kept for 24 hours (`lib/epic/accounts.ts`). |

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
│   └── health.ts                 # GET token + upstream status
├── lib/                          # Server-only unless noted
│   ├── types.ts                  # Event, Window, Entry … (shared with browser)
│   ├── status.ts                 # windowState(), cacheSecondsFor() (shared)
│   ├── auth/
│   │   ├── cookie.ts             # HMAC sign/verify for the session cookie
│   │   └── epicToken.ts          # Device-auth → access token, memoised
│   ├── epic/
│   │   ├── client.ts             # fetch wrapper: auth header, 1 s spacing, backoff, 401 retry
│   │   ├── endpoints.ts          # URL builders (one place to fix when Epic changes)
│   │   ├── events.ts             # raw → Event[]/Window[]
│   │   ├── leaderboard.ts        # raw → Entry[]
│   │   ├── accounts.ts           # name ⇄ id, bulk lookup, memo
│   │   ├── templates.ts          # scoring + payout tables
│   │   └── cms.ts                # tournamentinformation (posters, titles)
│   ├── http.ts                   # json(), cacheHeaders(), error envelope
│   └── health.ts                 # in-memory ring buffer of recent upstream calls
├── src/                          # Vite + React + Tailwind
│   ├── main.tsx, App.tsx, router.tsx
│   ├── api/                      # typed fetchers for /api/*
│   ├── hooks/
│   │   ├── useLiveQuery.ts       # interval by window state, pauses when hidden, backoff
│   │   ├── useNow.ts             # 1 s ticker for countdowns
│   │   └── useLocalStorage.ts
│   ├── store/                    # follows, settings, lastBoard (localStorage)
│   ├── components/               # RegionSwitcher, Countdown, StatusBadge, LeaderboardRow …
│   └── pages/                    # Home, Events, EventDetail, Leaderboard, Player, Me, Follows, Settings, Health, Login
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

`Entry` and `LeaderboardPage` arrive in Phase 2.

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

### Phase 3 — v1 leaderboard depth (~4 sessions)

Features: F14, F15, F16, F17, F18, F21, F24, F31, F34.

- **F14 Full depth:** infinite scroll fetching subsequent pages only on scroll; jump-to-rank input.
- **F15 Movement:** `store/lastBoard` saves `{teamKey → rank}` for the visible page + follows per window; diff on each refresh; cleared when the window is final.
- **F16 Cutoff line:** from `WindowDetail.cutoffs`; points taken = the entry at that rank (fetch that single page if needed).
- **F17 Match breakdown:** expand row → `entry.sessions` (already in payload).
- **F18 Pinned follows:** strip above the list via `accountIds` mode. Live windows rescan at most every 5 min (D10); rows on pages already loaded update every tick.
- **F21 Scoring panel:** side panel on desktop, bottom sheet on phone.
- **F24 Team grouping:** `teamKey` = sorted member IDs; follows can be grouped into named teams.
- **F31 CSV export:** client-side from loaded pages (and "export all" that walks pages for final windows only).
- **F34 PWA + dark mode:** `vite-plugin-pwa` manifest + app-shell cache (never cache `/api/*` in the service worker — Epic data must stay fresh); Tailwind `dark:` via `prefers-color-scheme`.

### Phase 4 — v1 schedule & history (~3–4 sessions)

Features: F4, F5, F8, F23, F28, F29.

- **F4 Calendar:** month/week grid built from all regions' windows (or current region; setting).
- **F5 iCal feed:** `api/ics.ts` → `text/calendar`. Calendar apps can't send cookies, so this route uses a **separate secret token in the query string** (`ICS_TOKEN`), excluded from the cookie middleware and checked in middleware instead. Cache 15 min.
- **F8 Search:** client-side fuzzy match over all regions' cached event lists.
- **F23 Player page:** season history, best finishes, earnings from payout tables.
- **F28 Cutoff history:** for each ended window, points at each cutoff rank (one page fetch per cutoff, cached 24 h). Group by event type × region.
- **F29 Points charts:** Recharts line of points per match for a team.

### Later (not scheduled)

F9 eligibility (needs the player-tokens endpoint working for *your* account, not the service account), F19 projected cutoff and F20 points calculator (build on F28 data), F26 head-to-head, F27 replay stats via api-fortnite.com, F30 Power Rankings scraper.

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
| `APP_PASSPHRASE` | `api/login.ts` |
| `COOKIE_SECRET` | cookie HMAC |
| `ICS_TOKEN` | Phase 4 iCal feed |

**Politeness budget (F37):** server-side spacing + CDN cache + client pause-when-hidden. `/api/health` shows upstream calls per minute so this is observable, not assumed.

**Security checklist:** no secrets in the bundle (CI greps the build output for env var names), `HttpOnly` cookie, middleware gate covers cached responses, no CORS, the iCal token is the only query-string secret and is rotatable.

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
