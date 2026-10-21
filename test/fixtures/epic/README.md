# Epic fixtures

Anonymized copies of real Epic responses, one folder per capture. Phase 1 parser tests read these.

How a folder gets here:
1. `npm run epic:probe -- --label <name>` saves a raw capture to `captures/epic/<name>/`. That folder is git-ignored, because it holds other players' data.
2. `npm run epic:anonymize -- captures/epic/<name>` writes the publishable copy here.

The anonymized copy differs from the capture in four ways:
- Account and session IDs become stand-ins like `f000…0042`, kept consistent across files so team, bulk-lookup and URL references still line up.
- Display names become `Player00001`, `Player00002`, and so on.
- Country flags (`GroupIdentity_GeoIdentity_*`) and spectate tokens are redacted.
- Credentials were already stripped by the probe.

Ranks, points, match stats, event and window IDs, scoring and payout tables are unchanged. The CMS document holds no player data and is copied as is.

Never put hand-written data here: synthetic test data belongs in `test/helpers/`.
