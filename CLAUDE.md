# YosikReboot

Personal, single-user Fortnite competitive schedule + live leaderboard web app. No database, free data only, no notifications.

- Product spec: `docs/DEVELOPER_PLAN.md`
- Build order and module layout: `docs/IMPLEMENTATION_PLAN.md`
- Verified Epic API shapes (after Phase 0): `docs/EPIC_API_NOTES.md`

## Stack
Vite + React + TypeScript + Tailwind (`src/`), Vercel Functions (`api/`), shared code in `lib/`, Vitest with saved Epic fixtures (`test/fixtures/epic/`).

## Commands
- `npm test`: Vitest. `npm run typecheck`: tsc.
- `npm run epic:device-auth`, `npm run epic:probe` and `npm run epic:analyze`: Phase 0 tools; see `docs/EPIC_API_NOTES.md`.

## Rules
- Only `api/` + `lib/` talk to Epic. The browser never sees Epic's raw format or any credential.
- The passphrase gate lives in `middleware.ts` so it also covers CDN-cached responses.
- API responses are identical for every caller (they're CDN-cached); per-user logic stays in the browser.
- Errors are `Cache-Control: no-store`.
- Times are UTC ISO on the wire; format in the browser with the user's time zone setting.
- Key players and teams by account ID, never display name.
- Parser changes need a fixture-based test. `test/fixtures/epic/` holds real captures only; synthetic test data lives in `test/helpers/`.
