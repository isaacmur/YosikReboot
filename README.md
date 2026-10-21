# YosikReboot

A personal web app for the Fortnite competitive schedule and live tournament leaderboards: every region in Eastern time, live boards that refresh about once a minute, and a short follow list. It reads Epic's events service through a few serverless routes. There is no database, and it's for one user behind a passphrase.

Not affiliated with or endorsed by Epic Games.

## Status

- **Phase 0 (prove the data): done.** See [docs/EPIC_API_NOTES.md](docs/EPIC_API_NOTES.md).
- **Phase 1 (gated app with the 8-region schedule): done.** It has passphrase login, all eight regions' events in your time zone with countdowns, filters, event details and an API health page.
- **Phase 2 (live leaderboards, follows, your results): next.**

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
