# YosikReboot

Personal, single-user Fortnite competitive schedule + live leaderboard web app. No database, free data only, no notifications.

- Product spec: `docs/DEVELOPER_PLAN.md`
- Build order and module layout: `docs/IMPLEMENTATION_PLAN.md`
- Verified Epic API shapes (after Phase 0): `docs/EPIC_API_NOTES.md`

## Stack
Vite + React + TypeScript + Tailwind (`src/`), Vercel Functions (`api/`), shared code in `lib/`, Vitest with saved Epic fixtures (`test/fixtures/epic/`).

## Commands
- `npm run dev`: local app. `npm run build`: production build into `dist/`.
- `npm run check`: everything CI runs (lint, format:check, typecheck, test, build). Run it before pushing.
- `npm test`: Vitest. `npm run typecheck`: tsc for the Node side (`tsconfig.json`) and the app (`tsconfig.app.json`).
- `npm run format`: Prettier (single quotes, 120 columns).
- `npm run epic:device-auth`, `epic:probe`, `epic:anonymize` and `epic:analyze`: Epic capture tools; see `docs/EPIC_API_NOTES.md`.

- Changing dependencies: npm 10 crashes resolving vitest's optional peers (`edgesOut`), so use `npx npm@11.6.2 install <pkg>`. `npm ci` on npm 10 is fine.

## Rules
- Only `api/` + `lib/` talk to Epic. The browser never sees Epic's raw format or any credential. `src/` may import only `lib/types.ts` and `lib/status.ts`.
- The passphrase gate lives in `middleware.ts` so it also covers CDN-cached responses.
- API responses are identical for every caller (they're CDN-cached); per-user logic stays in the browser.
- Errors are `Cache-Control: no-store`.
- Times are UTC ISO on the wire; format in the browser with the user's time zone setting.
- Key players and teams by account ID, never display name.
- Parser changes need a fixture-based test. `test/fixtures/epic/` holds anonymized real captures only; synthetic test data lives in `test/helpers/`.
- The repo is public. Raw captures stay in git-ignored `captures/`; never commit them or anything copied from them without `epic:anonymize`.
