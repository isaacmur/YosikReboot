# YosikReboot

A personal web app for the Fortnite competitive schedule and live tournament leaderboards: every region in Eastern time, live boards that refresh about once a minute, and a short follow list. It reads Epic's events service through a few serverless routes. There is no database, and it's for one user behind a passphrase.

Not affiliated with or endorsed by Epic Games.

## Status

- **Phase 0 (prove the data): done.** See [docs/EPIC_API_NOTES.md](docs/EPIC_API_NOTES.md).
- **Phase 1 (gated app with the 8-region schedule): done.** It has passphrase login, all eight regions' events in your time zone with countdowns, filters, event details and an API health page.
- **Phase 2 (live leaderboards, follows, your results): done.** It has live boards that refresh every minute (Ranked Cup tiers and FNCS cumulative included), per-match points, scoring and payouts, a follow list, and your season results.
- **Design overhaul: done.** A dark, poster-led look with tournament art throughout. Opening an event lands on its most recent leaderboard, with session and region pickers to switch.
- **Phase 3 (leaderboard depth): done.** Boards go down to the top 10,000 by scrolling or jumping to a rank. It adds movement arrows, qualifying and prize lines with the points they take, pinned follows and saved teams, scoring beside the board, CSV export, and an installable app.
- **Phase 4 (calendar, iCal feed, search, player pages, cutoff history): next.**

## Docs

- [Developer plan](docs/DEVELOPER_PLAN.md): what the app does and why
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): build order, module layout, design decisions
- [Epic API notes](docs/EPIC_API_NOTES.md): verified response shapes and the capture runbook

## Development

Requires Node 22 or later.

```sh
npm ci
npm run dev     # local app with the real API routes (reads .env.local)
npm run check   # lint, format, typecheck, tests, build (same as CI)
```

Copy `.env.example` to `.env.local` for the Epic tools and, from Phase 1, the API routes. Never commit `.env.local` or anything under `captures/`.
