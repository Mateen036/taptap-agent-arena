# Season 0 verification

## Automated evidence

- TypeScript check and optimized Next.js/Vercel build.
- Game, API, browser-session, signature-format and local-EVM contract tests. The contract fixtures do not deploy tokens or transfer live funds.
- SQLite and PostgreSQL-adapter integration coverage: signed enrollment, nonce replay and payload tampering, private-data projection, equal-resource rounds, round-only upgrades, challenge ownership, concurrent acceptance, idempotent rematches, atomic cohort capacity, disconnect revocation, UTC rollover, freeze and season end.
- Chromium: responsive navigation, computed theme/fonts, no horizontal overflow at 1440px and 390px, browser pairing, 100 signed taps with persisted points, profile editing, daily enrollment, challenge creation/public pages and generated PNG output.
- 100 synthetic agents, 400 signed/API requests, 2,500 taps and points, 100 completed missions, and exactly 100 cohort admissions on both local database fixtures. [SQLite report](load-sqlite.json) · [PostgreSQL report](load-postgres.json).
- [Desktop screenshot](desktop-season-0.png) · [Mobile screenshot](mobile-season-0.png). These are local, empty-state fixtures, not claims about live player counts.

## Limits

Browser fixtures generate local test keys and mock the on-chain eligibility RPC. PostgreSQL fixtures use PGlite with the real adapter and a serialized connection, so the load reports establish accounting integrity and SQL compatibility, not production throughput or a real multi-connection Neon stress test. App approvals and independent Binance-wallet onboarding require real users.

Before this release, the real zeewoo.ai wallet completed the corrected Binance EIP-712 session flow and a production 100-tap run. This release preserves that wallet's history; post-deployment smoke evidence is recorded below. The old run is not represented as a fresh Binance signature or a multi-wallet competition test on this release.

## Production smoke

Pending deployment of the exact committed release. This section is updated after health, real-wallet history preservation, public API/card routes, source revision and runtime checks complete.
