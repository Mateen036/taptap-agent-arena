# Nib Foundry: BNB testnet review

This isolated application uses chain 97, disposable server-side agents, a clearly marked test identity registry, test tUSDT and a future test LP token. These assets have no monetary value. Binance Agentic Wallet does not currently support chain 97; real Binance login, Agent ID ownership and signing require a separate final mainnet check. Nothing in this branch authorizes mainnet deployment.

The production game and its database are not used by this review application. Token launch and conversion ratios remain TBA.

## Review flow

1. Select Alpha, preview and approve one free mint. Only test gas is charged.
2. Make another mint: approve the exact tUSDT amount, then preview and approve the mint. Check proceeds in LP vault.
3. In Your NFTs, approve one individual NFT and then list it. The seller keeps custody until sale.
4. Select Beta, review the listing, approve the exact test payment, then purchase. Check both agents' balances and NFT ownership.
5. Test cancellation, old quotes, and ten lifetime mints. Selling does not restore mint allowance.
6. Browse all 10,000 original designs, inspect traits, check mobile layout, and open transaction explorer receipts.
7. Select Operator for owner-only LP functions. The real two-day token-selection delay starts with the proposal transaction. After that delay, activate the test token and add test liquidity through the official PancakeSwap V2 testnet router. LP tokens cannot be withdrawn.

Quotes expire after five minutes, are HMAC authenticated, and bind the actor, chain 97, target, calldata, zero native value, gas limits and nonce. Explicit approval is required. Retries reuse the same signed bytes and transaction hash, never a fresh nonce. Successful receipts must match the approved call and have three confirmations. Ownership, balances and available listings come from contracts; browser-local receipt history is not a shared activity feed.

## Deployment

Vercel project `taptap-nft-testnet`, root `deploy/testnet`, Node 24. Vercel Authentication protects all deployments because the test actors share disposable gas balances. Open with the owning Vercel account. The application has no database dependency.

Server-only variables:

- `TESTNET_MODE=bnb-testnet`
- `TESTNET_RPC_URL`: chain 97 HTTP RPC
- `TESTNET_DEPLOYMENT`: public deployment manifest from `deployment.json`
- `TESTNET_WALLETS`: chain 97 disposable keystore; never add to Git or browser bundles
- `TESTNET_REVIEW_SECRET`: at least 32 random characters, server-only

While contracts are pending, only mode and the public manifest are needed. The page shows the actual deployer balance and disables transaction controls. The public manifest contains addresses and hashes only.

`NODE_USE_ENV_PROXY=1 npx tsx scripts/nft-testnet-deploy.ts` compiles the test helpers and checks network/funding without broadcasting. Add `--broadcast` only for the authorized testnet deployment. The script loads the local disposable keystore, persists a private transaction journal before each broadcast, deploys the same core NFT/market/vault/renderer artifacts plus test-only support contracts, funds Alpha/Beta with test gas, allocates 100 tUSDT per agent and proposes the test LP token. All network checks must report97. The public manifest updates after successful initialization.

Current funding target: **0.1 tBNB on chain 97** at `0xec79109F601A8850A21CC6e01E1C0cCab2313dc2`. Use a free testnet faucet or existing test BNB. No real BNB is needed.

## Verification

```
npm run check
npm test
npm run build:testnet
npm run test:browser:testnet
```

The testnet browser fixture runs the real Next application against a local chain 97 with disposable accounts and mock DEX infrastructure. Public-chain checks remain separate. Local time manipulation tests the LP delay without pretending that public testnet time can be accelerated. Existing core contract tests cover the 10,000 supply boundary and artwork uniqueness.
