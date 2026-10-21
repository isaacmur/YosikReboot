# YosikReboot

Personal, single-user Fortnite competitive schedule + live leaderboard web app. No database, free data only, no notifications.

- Product spec: `docs/DEVELOPER_PLAN.md`
- Build order and module layout: `docs/IMPLEMENTATION_PLAN.md`
- Verified Epic API shapes (after Phase 0): `docs/EPIC_API_NOTES.md`

## Stack
Vite + React + TypeScript + Tailwind (`src/`), Vercel Functions (`api/`), shared code in `lib/`, Vitest with saved Epic fixtures (`test/fixtures/epic/`).

## Commands
- `npm run dev`: local app, with the real API routes and middleware (needs `APP_PASSPHRASE`, `COOKIE_SECRET` and the `EPIC_*` values in `.env.local` or the environment). `npm run build`: production build into `dist/`.
- `npm run check`: everything CI runs (lint, format:check, typecheck, test, smoke:api, build). Run it before pushing.
- `npm run smoke:api`: compiles `api/`, `lib/` and `middleware.ts` and loads them with bare Node, the way Vercel runs them.
- `npm test`: Vitest. `npm run typecheck`: tsc for the Node side (`tsconfig.json`) and the app (`tsconfig.app.json`).
- `npm run format`: Prettier (single quotes, 120 columns).
- `npm run epic:device-auth`, `epic:probe`, `epic:anonymize` and `epic:analyze`: Epic capture tools; see `docs/EPIC_API_NOTES.md`.

- Changing dependencies: npm 10 crashes resolving vitest's optional peers (`edgesOut`), so use `npx npm@11.6.2 install <pkg>`. `npm ci` on npm 10 is fine.

## Rules
- Only `api/` + `lib/` talk to Epic. The browser never sees Epic's raw format or any credential. `src/` may import only `lib/types.ts` and `lib/status.ts`.
- The passphrase gate lives in `middleware.ts` so it also covers CDN-cached responses.
- API responses are identical for every caller (they're CDN-cached); per-user logic stays in the browser.
- Errors are `Cache-Control: no-store`. Cacheable API responses use `cdnCacheHeaders()`: the browser never stores them, and Vercel's CDN caches them via `Vercel-CDN-Cache-Control` (D12).
- Relative imports in `api/`, `lib/` and `middleware.ts` end in `.js`. Vercel doesn't bundle functions (D13).
- Players are found by scanning boards in the browser (`src/scan.ts`, D10); never add server-side loops over many board pages (functions have a 30 s limit). A board refreshes only the pages listed in D18 (`src/useBoard.ts`).
- The service worker (`pwa/sw.js`, filled in at build time by `vite.config.ts`) never caches or handles `/api/*` (D20).
- Ranked Cup standings are the tier boards; the main Ranked Cup board has no points (D14).
- Route handlers are built by `make…Handler(deps)` factories, so tests can inject a fake `EpicClient`. Only `GET`/`POST`/`DELETE` exports are routes.
- Times are UTC ISO on the wire; format in the browser with the user's time zone setting.
- UI: colors are tokens in `src/index.css` (dark default, light override); build on the primitives in `src/components/ui.tsx`. Show event art with `Art`, which asks Epic's CDN for a resized copy. Don't override a primitive's classes through `className` (two Tailwind classes for the same property have no reliable winner); add a prop instead, like `tone` or `size`.
- Key players and teams by account ID, never display name.
- Parser changes need a fixture-based test. `test/fixtures/epic/` holds anonymized real captures only; synthetic test data lives in `test/helpers/`.
- The repo is public. Raw captures stay in git-ignored `captures/`; never commit them or anything copied from them without `epic:anonymize`.
