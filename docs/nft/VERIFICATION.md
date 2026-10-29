# NFT verification evidence

**Story:** browser request → signed agent claim → exact Binance-style preview → explicit browser approval → agent wallet transaction → matching successful BNB-chain receipt → updated NFT ownership/market state.

## Local checks

- All 10,000 six-trait combinations and SVG hashes are unique.
- The deployed Solidity renderer matches the original website SVG byte-for-byte for eight representative serials, including both boundaries. Its JSON metadata embeds the same SVG and all six traits.
- Every runtime fits the 24,576-byte mainnet size limit. The atomic CREATE2 deployment bundle rolls back all earlier deployments if a later deployment fails, and its valid runtime addresses match the prepared plan.
- Mint checks: first free, exact later payment, batch cap, ten lifetime mints, replayed intent rejection, missing identity, pause, recipient eligibility, sale not resetting the mint cap, supply boundary at 10,000 and rejection of token 10,001.
- Marketplace checks: noncustodial listing, exact version/price/seller, eligibility, stale quote rejection, atomic USDT delivery/NFT ownership, sale accounting, expired/invalid listing cleanup.
- Vault checks: no owner withdrawal method, future-token delay, permanent token selection, matching deposits, liquidity addition, locked LP tokens and cleared router approvals.
- SQLite and the PostgreSQL adapter: real EIP-712 game signatures, exact preview binding, browser-owner authorization, approval consumption once, submitted spends not hidden as ordinary failures, unverified hashes unable to block another wallet's receipt, successful on-chain receipt verification and disconnect cancellation.
- Runner checks: no repeated uncertain execution and no journal/approval consumption when a known wallet preflight fails.
- Chromium: responsive Foundry and Market views, art/traits, honest undeployed state, free mint queue, exact preview review/approval, real local-EVM mint receipt, NFT ownership readback, individual NFT approval and marketplace listing. Existing game/browser checks still run.

[Desktop preview](desktop-foundry.png) · [Mobile preview](mobile-foundry.png). The screenshots and blockchain tests use **local synthetic wallets**, mocked registry/payment/router dependencies and a Ganache chain 56 fixture. They are not live NFT sales, live funds or Binance app approvals. The database compatibility fixture uses PGlite with a serialized connection, not a production Neon throughput benchmark.

## Release state

Mainnet deployment is pending an exact Binance transaction preview and owner approval. The site must keep mint/trade controls disabled until successful chain receipt, runtime verification and production configuration. No NFT deployment, mint payment or gas spending is authorized merely by this report. The previous production TapTap signing and 100-tap test are separate evidence for game integration.

The contracts have meaningful automated coverage and a bounded read-only review, **not an independent security audit**. Registry eligibility does not establish AI authorship. LP-token economic quality remains an owner decision, and the future token remains TBA.
