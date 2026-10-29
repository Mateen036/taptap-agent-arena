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

The production deployment is READY at https://taptap-agent-arena.vercel.app, with application source `a5936cb5e6fcab8ffeff6407e60329a2bcf0b7bb` (deployment `dpl_7UFR2RLwnCUtY19w1rMopwQMEFnD`). See [the machine-readable smoke report](production-smoke.json).

Live checks passed: database health, 100 TAP / 100 taps / one completed run preserved for the real existing wallet, public profile, real completed-run Open Graph metadata, season/profile/run PNGs, guide, launch kit and connector downloads. Public Chromium checks at 1440px and 390px passed all six navigation views, theme/fonts, overflow, pairing-instruction generation, existing-wallet readback and zero page errors. [Live desktop](production-desktop.png) · [Live mobile](production-mobile.png).

No fresh Binance main-wallet signature or independent two-wallet match was executed during this release smoke test. The earlier real Binance signing/100-tap result and the new synthetic signed-competition tests are separate evidence. Token conversion remains unavailable.

Season 0 opened **29 October 2026 at 10:01 AM PKT** and closes **5 November 2026 at 10:01 AM PKT** (05:01 UTC). The dashboard shows the authoritative UTC deadline. At verification, zero competition slots were occupied; no synthetic test users or scores were inserted into production.

Runtime diagnostics report no application error groups; the existing PostgreSQL SSL-mode deprecation warning remains. Current connections retain certificate verification. GitHub Actions passed the same type, game, browser, load and build checks: [release CI run](https://github.com/Mateen036/taptap-agent-arena/actions/runs/40820893724).
