# NFT utility release

Formula: new TAP = base TAP × 2^current collection balance. One Nib and a current Agent ID are required for gameplay. Competitive scores are unchanged. Existing TAP is preserved. Contracts' 10-NFT mint allocation remains separate from holdings.

Release order (operator commands, not public APIs):

1. Pass typecheck, backend tests on SQLite/Postgres, browser flows and Vercel build. Publish reviewed source and preview.
2. Obtain a fresh Binance preview and the user's explicit approval for the actual mainnet deployment. Deploy the reviewed contracts; verify runtime bytecode, immutable links, owner and economic constants with `nft-deploy.ts verify`. Do not use testnet substitutes.
3. Apply `npm run db:migrate:postgres` with production credentials. Nullable exact columns are additive; this does not activate utility or revalue any balance.
4. Deploy this runtime to production with verified mainnet NFT contract addresses, initially **without** `NFT_GAME_UTILITY=true`. The persistent activation row is still absent. Verify deployed SHA. Never promote an environment using a different auth secret.
5. With the same production database, addresses and ADMIN_WALLET, run `npx tsx scripts/activate-nft-utility.ts check`, then `freeze`. This pauses both game generations. Wait at least 60 seconds (API maxDuration is 30) for in-flight work to drain.
6. Run `activate`. It backfills exact balances/command earnings/ledger deltas without changing their values; marks persistent `nft_utility_v1=active`; restores the prior new-runtime phase. The original `season_phase` stays **frozen permanently**, so old deployments connected to this database cannot bypass NFT rules or corrupt exact totals.
7. Verify production bootstrap shows required access, direct API rejects NFT-less gameplay, NFT tasks still work, and newly minted/transferred holdings update access and earned TAP. Do not mint or spend user funds without approved previews. Enable NFT_GAME_UTILITY=true as a redundant explicit deployment flag only after activation.

Never roll back to a numeric-only runtime after activation. Roll forward with exact accounting. If activation fails after freeze, leave gameplay paused and fix the cause; do not reopen legacy runtimes. Administrative freeze now targets season_phase_v2.

The ownership check is a fresh block snapshot per action, not an atomic transaction spanning BNB Chain and Postgres. A later transfer takes effect on the next check. RPC errors fail closed. A listed NFT stays in its owner's wallet until settlement and continues to count while held.
