# YosikReboot — Developer Plan

Oct 20, 2026 · @Isaac

## Overview and goals

Build a single-user web app that shows the Fortnite competitive schedule and live tournament leaderboards, fed straight from Epic's free events service through a small serverless backend, with no database and nothing paid. It is for your personal use only: no public pages, no ads, nothing written back to Epic, and no notifications: everything lives in the web app.

What a finished v1 lets you do:

- See every upcoming event in any of the eight regions, one tap apart, in Eastern time with session windows and countdowns.
- Open a live leaderboard during a session and see it refresh about once a minute.
- Follow a short list of players and teams, yourself included, and see where each one stands at a glance.
- Look back at this season's ended events, including your own results.
- Understand each event's scoring and qualification cutoffs without leaving the app.

The app is called **YosikReboot**.

## What Fortnite Tracker's events pages offer

Fortnite Tracker's events product has four parts: a schedule (list and calendar, exportable), per-session leaderboards for live and archived events, Power Rankings, and per-player event profiles that now go down to individual eliminations.

| Area | What it does | Source |
| --- | --- | --- |
| Events hub | Leaderboards for all current and historic competitive tournaments, with prize pools, rules and player info | [Events page](https://fortnitetracker.com/events) |
| Region and live view | Pick a region to see live, upcoming and historic events; calendar view needs a region | [Events page](https://fortnitetracker.com/events) |
| Calendar export | Monthly calendar of the whole schedule with a Download iCal (.ics) button | [Oct 2021 update](https://tracker.gg/fortnite/articles/lifetime-power-rankings-calendar-exports-much-more-comes-to-fortnite-tracker) |
| Event coverage | FNCS divisions, heats and finals; Ranked Cups (BR and Zero Build); Victory Cups; Performance Evaluations; mobile series; promo cups, by region | [Joytify overview](https://www.joytify.com/blog/en-us/moba-and-fps/fortnite-tracker/) |
| Leaderboards | One per event window (session), paginated; covers the top 10,000; your profile only lists events where you placed top 10K, up to 48 h after | [TRN support thread](https://feedback.tracker.gg/t/tracker-doesnt-track-my-events/20124) |
| Archived results | Look back at an event's placement thresholds and how scoring played out | [Joytify overview](https://www.joytify.com/blog/en-us/moba-and-fps/fortnite-tracker/) |
| Power Rankings | Current PR (decays to zero within 18 months), yearly and lifetime views, split by region | [Oct 2021 update](https://tracker.gg/fortnite/articles/lifetime-power-rankings-calendar-exports-much-more-comes-to-fortnite-tracker) |
| Event eliminations | Per-event list of everyone you or your team eliminated; highest-PR elim, average victim PR, replay availability | [Oct 2026 update](https://tracker.gg/fortnite/articles/new-fortnite-tracker-features-event-eliminations-head-to-head-stats-lifetime-top-kills-2) |
| Top Kills, head-to-head, Nemesis | Career elimination archive with each opponent's PR and earnings; head-to-head matchups; who eliminated you most | [Oct 2026 update](https://tracker.gg/fortnite/articles/new-fortnite-tracker-features-event-eliminations-head-to-head-stats-lifetime-top-kills-2) |
| Looking for Player | Board for finding scrim and event teammates | [Joytify overview](https://www.joytify.com/blog/en-us/moba-and-fps/fortnite-tracker/) |
| Apps and Premium | Mobile app with events; Premium removes ads for $3.99/mo | [Oct 2021 update](https://tracker.gg/fortnite/articles/lifetime-power-rankings-calendar-exports-much-more-comes-to-fortnite-tracker) |

Epic's own [event pages](https://www.fortnite.com/competitive/events/S34_FNCSMajor2_PlayInStage/?region=EU) are a useful second reference. They show a countdown, the leader's summary (matches, Victory Royales, average elims, points and placement), a leaderboard of place, players, points, VRs, matches and elims, a per-session schedule, eligibility rules, and a switcher across eight regions: ASIA, BR, EU, ME, NAC, NAE, NAW, OCE.

## Data sources and access

Use Epic's events service as the primary feed: it carries the full schedule and every window's leaderboard, at no cost, but it needs an Epic account token and is undocumented. Everything else is a supplement or a fallback.

| Source | What it gives | Auth | Cost | Role |
| --- | --- | --- | --- | --- |
| Epic events service (`events-public-service-live.ol.epicgames.com`) | Event list with windows; per-window leaderboards; window and per-player history; competitive tokens ([endpoint list](https://gist.github.com/Doc94/4dff32bfba0c9036166bc3244ea55e55), [fnbr endpoints](https://app.unpkg.com/fnbr@4.1.2/files/dist/resources/Endpoints.d.ts)) | Epic account bearer token | Free | Primary |
| Epic account service (`account-public-service-prod.ol.epicgames.com`) | Display name to account ID and back ([endpoint list](https://gist.github.com/Doc94/4dff32bfba0c9036166bc3244ea55e55)) | Same token | Free | Follow-list lookups |
| Epic tournament info CMS ([tournamentinformation](https://fortnitecontent-website-prod07.ol.epicgames.com/content/api/pages/fortnite-game/tournamentinformation)) | Titles, poster images, colors, format descriptions | None | Free | Display data |
| fortnite.com/competitive ([schedule](https://www.fortnite.com/competitive/schedule), event pages) | Public schedule, event pages, leaderboards, Power Rankings | None | Free | Power Rankings; fallback if the token breaks |
| [api-fortnite.com](https://api-fortnite.com) free tier | 10,000 requests a day: account lookup, season dates, raw tournament replay downloads, 15 replay-parse credits a day (stats endpoint only). Event leaderboards and Power Rankings are Pro-only | Free key | Free | Later: your own match stats from replays |

**How long Epic keeps events:** the events list only covers the current season ([fortnite\_2 docs](https://github.com/oxelf/fortnite_2.0)), so ended events drop off when a new season starts, which usually happens every few months. Epic's support page says past-season leaderboards aren't public on its site or in the Compete tab ([Epic support](https://www.epicgames.com/help/c-34254770/c-45529661/competitive-leaderboards-a19909440)), although some old event pages still load on fortnite.com, such as the April 2025 FNCS Play-In above. A player's recent-session data lasts only about 36 hours ([SDK notes](https://www.npmjs.com/package/@yaelouuu/fortnite-api)). With no database, YosikReboot's history is whatever this season's list still holds.

**Endpoints to build against** (Game ID is `Fortnite`):

- `GET /api/v1/events/Fortnite/data/{accountId}` and `/download/{accountId}`: events, windows and templates visible to that account.
- `GET /api/v1/leaderboards/Fortnite/{eventId}/{eventWindowId}/{accountId}`: one window's leaderboard, paged.
- `GET /api/v1/events/Fortnite/{eventId}/{eventWindowId}/history` and `.../history/{accountId}`: results history for a window or one player.
- `GET /api/v1/players/Fortnite/tokens`: competitive tokens per account, which drive eligibility and divisions.

Event and window IDs carry the region, for example event `epicgames_S23_ZBMQuickCupFill_EU` with window `S23_ZBMQuickCupFill_Event9_EU` ([example](https://feedback.tracker.gg/t/tracker-doesnt-track-my-events/20124)). Each window carries `beginTime`, `endTime`, `countdownBeginTime`, `round`, `payoutDelay`, `isTBD`, `canLiveSpectate`, `blackoutPeriods`, `scoreLocations`, token requirements and `teammateEligibility` ([field list](https://pub.dev/documentation/fortnite_2/latest/fortnite_2/EventWindows-class.html)).

Not yet verified, so Phase 0 confirms them against a live response: the leaderboard entry shape (team account IDs, rank, points, per-match session history), the scoring and payout tables in event templates, page size, how the token is minted and refreshed, and whether one schedule call returns all eight regions. Treat these as approximate until then.

**Account setup:** sign the service in with a secondary Epic account you own, store its device-auth credentials as server secrets only, and never ship them to the browser.

## Feature list

The plan has 37 features in five areas: 16 MVP, 15 v1 and 6 later, all built on free data. The MVP covers the schedule and live leaderboards for every region plus your own results this season. Change any Tier cell from its dropdown.

### Schedule and discovery

| # | Feature | What it does | Tier |
| --- | --- | --- | --- |
| 1 | Event list | Upcoming, live and ended tabs for any region | MVP |
| 2 | Local times and countdowns | Every session in Eastern time, with a countdown to the next one | MVP |
| 3 | Filters | Mode (BR, Zero Build, Reload), team size, event type (FNCS, Ranked Cup, Victory Cup, Cash Cup, Performance Evaluation, Mobile), platform | MVP |
| 4 | Calendar view | Month and week grid of all sessions | v1 |
| 5 | Live iCal feed | A subscribable calendar URL that updates itself, not a one-off download | v1 |
| 6 | Event detail page | Poster, description, format, eligibility, rounds and sessions, scoring | MVP |
| 7 | Region switcher | All eight regions (NAC, NAE, NAW, EU, BR, OCE, ME, ASIA): a default region plus one-tap switching on every page | MVP |
| 8 | Event search | Find any event or past window by name | v1 |
| 9 | Eligibility check | Flag events your own account can enter, from the window's token requirements | Later |

### Live leaderboards

| # | Feature | What it does | Tier |
| --- | --- | --- | --- |
| 10 | Window leaderboard | Rank, team, points, Victory Royales, matches, elims, average placement | MVP |
| 11 | Auto-refresh | Refreshes every 60 s while live, then every 5 min until results settle, with a last-updated stamp | MVP |
| 12 | Session and cumulative toggle | Switch between one session's board and the event's running total | MVP |
| 13 | Find a player | Search names on the board and jump to their row | MVP |
| 14 | Full depth | Page or scroll to the top 10,000, matching Fortnite Tracker | v1 |
| 15 | Movement arrows | Show places gained or lost since the last refresh | v1 |
| 16 | Cutoff line | Draw the qualifying or payout line (for example top 99) and the points it currently takes | v1 |
| 17 | Match breakdown | Expand a team to see each game's placement, elims and points | v1 |
| 18 | Pinned follows | Keep followed players in a strip above the board, wherever they rank | v1 |
| 19 | Projected cutoff | Estimate where the line settles, from this season's ended events of the same type | Later |
| 20 | Points calculator | What placement and elims a team needs in the games left to make the cutoff | Later |
| 21 | Scoring panel | The event's placement and elimination points table, beside the board | v1 |

### Players and teams

| # | Feature | What it does | Tier |
| --- | --- | --- | --- |
| 22 | Follow list | Track players by Epic name, stored by account ID in this browser, with export and import | MVP |
| 23 | Player page | This season's event history, best finishes, and earnings from the payout tables | v1 |
| 24 | Team grouping | Keep duos and trios together across events | v1 |
| 25 | My dashboard | Your own events this season, live rank during a session, and placement trend | MVP |
| 26 | Head-to-head | Compare two players' placements across the events they shared this season | Later |
| 27 | Your match stats from replays | Download your tournament replays and parse them on api-fortnite.com's free tier (15 credits a day) | Later |

### History and analytics

| # | Feature | What it does | Tier |
| --- | --- | --- | --- |
| 28 | Cutoff history | The points it took to qualify this season, by event type and region, read from ended windows | v1 |
| 29 | Points charts | A followed team's points match by match | v1 |
| 30 | Power Rankings | Epic's public PR page for each region | Later |
| 31 | CSV export | Download any leaderboard or player history | v1 |

### App and operations

| # | Feature | What it does | Tier |
| --- | --- | --- | --- |
| 32 | Passphrase gate | One passphrase unlocks the app; the API routes refuse anyone without its cookie | MVP |
| 33 | Phone layout | Usable one-handed during a session | MVP |
| 34 | Installable app and dark mode | Add to home screen; follows your system theme | v1 |
| 35 | API health | Token status, last Epic response, recent errors | MVP |
| 36 | Settings | Default region, time zone, refresh interval, stored in this browser | MVP |
| 37 | Polite fetching | Refresh only while a board is open; cache responses so repeat views don't reach Epic | MVP |

## Architecture and tech stack

No database: the browser asks a few Vercel API routes for data, and only those routes talk to Epic, with a token minted from device-auth credentials in Vercel environment variables. Vercel's CDN caches each response, which it does on every plan ([Vercel docs](https://vercel.com/docs/caching/cdn-cache)), so a 60-second refresh reaches Epic at most once per cache window. Nothing runs while the app is closed.

&#91;embedded content: YosikReboot architecture · browser, Vercel, Epic\]

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Vite, React, Tailwind, hosted on Vercel Hobby | The stack you already ship on; free |
| API routes | Vercel Functions in TypeScript: `/api/events`, `/api/window`, `/api/leaderboard`, `/api/player` | Hold the Epic token; trim Epic's responses to what each page needs |
| Caching | Vercel CDN via `Cache-Control: s-maxage` | Live boards 30 s, wrapping-up boards 5 min, final boards 24 h, schedule 15 min |
| Secrets | Vercel environment variables | Device-auth credentials and the passphrase never reach the browser |
| Browser storage | `localStorage` | Follows, settings, and the last board seen, for movement arrows |
| Charts | visx or Recharts | Points-per-match and cutoff-history charts |
| Tests | Vitest, with saved Epic responses as fixtures | Parser tests run without calling Epic |

The trade-off of skipping a database: your follow list lives in one browser, so your phone and laptop each keep their own unless you export and import it.

## Where data lives

Nothing is stored on a server. Epic is the source of truth, Vercel's cache holds copies for seconds to hours, and the browser keeps a few small items.

| Data | Lives in | Notes |
| --- | --- | --- |
| Events, windows, leaderboards | Epic, cached by Vercel's CDN | Fetched on demand; gone from the app when Epic drops them at season end |
| Device-auth credentials, passphrase | Vercel environment variables | Server-side only |
| Access token | API route memory while the function is warm | Re-minted on a cold start or a 401 |
| Follow list, with your own account marked | `localStorage` | Account IDs plus labels; export and import as JSON |
| Settings | `localStorage` | Default region, time zone, refresh interval |
| Last board seen, per window | `localStorage` | Drives movement arrows; cleared once the window ends |

**Shapes the API routes return,** so the frontend never parses Epic's raw format: `Event { id, region, name, type, mode, teamSize, posterUrl, windows[] }`, `Window { id, round, begin, end, status, scoring, payouts }`, `Entry { rank, teamKey, members[], points, vrs, matches, elims, avgPlace, sessions[] }`.

## Fetching and live updates

Four API routes do all the work, and each calls Epic only when its cached copy has expired. The browser sets the pace: an open live board asks for a refresh every 60 s, and a closed tab asks for nothing.

| Route | Calls | Cache | Returns |
| --- | --- | --- | --- |
| `/api/events?region=` | Events `data` endpoint; CMS once a day | 15 min | This season's events and windows for a region, with status upcoming, live or ended |
| `/api/leaderboard?window=&page=` | Leaderboards endpoint | 30 s live, 5 min wrapping up, 24 h final | One page of normalized entries |
| `/api/window?window=` | Event template and window fields | 24 h | Scoring table, payout table, cutoff ranks |
| `/api/player?name=` or `?id=` | Account service, then this season's ended windows | 24 h per window | Account ID, display name and season results |

**Refresh rules:** each window's state, worked out from its start time, end time and Epic's `payoutDelay`, decides how often its board refreshes.

| State | When | Board refresh | Server cache |
| --- | --- | --- | --- |
| Upcoming | Before the start time | None; countdown only | None |
| Live | Start time to end time | Every 60 s (setting, minimum 30 s) | 30 s |
| Wrapping up | End time to end time + `payoutDelay` | Every 5 min | 5 min |
| Final | After that | None | 24 h |

The wrapping-up state exists because matches still in progress at the end time keep adding points. Epic may also adjust standings after a session, usually to remove disqualified players. If Phase 0 finds `payoutDelay` missing, wrapping up lasts 60 minutes.

- Refreshing pauses while the tab is hidden or the phone is locked, and runs once immediately on return.
- Only the visible page of the board and your followed players refresh; deeper pages load on scroll.
- On a 429 or 5xx, the next refresh waits 2 min, then 4, with a "Stale since" banner; one success resets it.
- Every board shows when it was last updated, for example "updated 12 s ago".

**Token:** a route mints an access token from the device-auth credentials on first use, keeps it in memory while the function stays warm, and mints again on a 401. Three failures in a row turn the health page red.

**Request budget:** at most one Epic call per URL per cache window, at least 1 s apart, with backoff on 429 or 5xx. If pages hold 100 entries (Phase 0 confirms), the top 10,000 is 100 pages, so deep pages load only when you scroll to them.

**Finding one player's results:** Phase 0 checks whether Epic will return a specific account's row or history directly. If it only serves that to the account itself, the route scans each ended board once and caches the answer for 24 h.

## Pages and UI

Nine routes. Home answers "what's on right now and how are my people doing" in one screen; everything else is one tap away.

| Route | What's on it |
| --- | --- |
| `/` Home | Live now (with a pulsing badge), next three sessions with countdowns, followed players' current rank |
| `/events` | Event list with filters and an upcoming, live, ended toggle; switch to calendar view |
| `/events/:eventId` | Poster, format, eligibility, windows by round and session, scoring panel, region switch |
| `/events/:eventId/:windowId` | The leaderboard: session or cumulative, search, cutoff line, pinned follows, match breakdown on expand |
| `/players/:accountId` | Event history, best finishes, earnings, points-per-match chart |
| `/me` | Your own events and placement trend |
| `/follows` | Add players by Epic name and mark which account is you |
| `/settings` | Default region, time zone, refresh interval |
| `/health` | Token status, last Epic response, recent errors |

**Leaderboard layout on a phone:** sticky header with the window name, the region switcher, a live, wrapping-up or final badge and "updated 12 s ago"; the pinned-follows strip; then rows of rank, team names, points and a movement arrow. Tapping a row expands its match breakdown. The cutoff line is a full-width rule with its points value.

## Build phases

Five phases, each ending in something you can see working; the MVP is done at the end of Phase 2. Phase 0 comes first because every later phase depends on what Epic's responses actually look like.

&#91;embedded content: Build phases · 5 phases, 3 gates\]

Each phase ends with a commit and push to GitHub. If you build with Claude Code, this plan plus a short CLAUDE.md is the handoff: Phase 0's fixtures double as the parser tests.

## Risks and mitigations

The biggest risk is that Epic changes the undocumented endpoints or restricts the account; a public-site fallback keeps the schedule usable if that happens.

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Epic changes or blocks the events endpoints | Live boards stop updating | Health page shows it on the next refresh; fallback reader for fortnite.com/competitive |
| Account action under Epic's Terms (no bot software to automate use; no reverse engineering) | The secondary account is suspended | Read-only calls, low request rate, no commercial use ([Epic ToS](https://cdn1.epicgames.com/eulatracking-download/epicgames_tos/en/v2/r1/45d4dd9e67fab2855ba409cd77569499.pdf), sections 3 and 4) |
| Token or auth flow changes | Requests fail with 401s | Re-mint on 401, stop after 3 failures, red health page |
| Rate limiting | 429 responses | Cache windows, backoff, deep pages only on scroll |
| Season rollover | Ended events drop out of the app | Expected, since history is this season only; export a board as CSV to keep it |
| Others using your API routes as a free Epic proxy | Extra traffic on your Epic account | Passphrase cookie checked on every route; no cross-origin access |
| Display names change | Follows break | Everything keyed on account ID |
| Follows live in one browser | Phone and laptop lists differ | Export and import as JSON |

I'm not a lawyer; the ToS row is my reading of Epic's Terms, not legal advice.

## Open questions

Decided on Oct 20: your own results and following events count equally, all eight regions with a switcher, all event types, no notifications, the name YosikReboot, free data only, and no database. Still open, with the plan assuming the first option in each:

- [ ] Who goes on the follow list, and what is your Epic name?
- [ ] Live depth: top 500 during sessions, or the full 10,000?
- [ ] Follows: one list per browser with export and import, or synced between devices?
