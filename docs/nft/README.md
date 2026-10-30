# Nib Collection deployment and operation

The collection and marketplace extend the existing TapTap app. Website: https://taptap-agent-arena.vercel.app/#collection · [Public rules](../../public/nft-guide.md) · [Artwork](ART.md) · [Verification](VERIFICATION.md).

## Fixed collection rules

10,000 ERC-721 NFTs, first mint free per eligible wallet, then 1 BNB Chain USDT or the BNB/USD equivalent of $1 per NFT, ten lifetime mints per wallet. No reserve, owner mint, supply expansion, adjustable price, random reveal or token allocation promise. Artwork and metadata are fully on-chain. Transfers, minting and marketplace counterparties require a SPACE ID Agent ID. Registry balance does not prove AI authorship, and an eligible wallet can call the contracts directly.

The collection owner can pause or reopen minting; the vault owner controls future token selection and liquidity addition, with ownership transfers requiring acceptance. The marketplace has no fee or administrative owner. The proposed owner is the user's verified zeewoo.ai wallet; review its public address in the deployment plan before signing.

## Contracts

| Contract | Purpose |
| --- | --- |
| `NibRenderer` | Immutable deterministic SVG and ERC-721 JSON metadata |
| `NibLPVault` | Receives USDT and wrapped BNB mint proceeds; two-day future-token selection; adds liquidity through immutable PancakeSwap V2 router; LP tokens cannot be withdrawn |
| `NibCollection` | ERC-721 enumerable collection, immutable economics and identity registry, per-wallet cap, replay-resistant mint intent IDs |
| `NibMarketplace` | Noncustodial fixed-price native BNB market; exact listing versions; atomic payment/delivery; fixed 2% buyer and 2% seller fees; owner-bound BNB bids, full-deposit cancellation credit and separate withdrawal |

The vault requires matching future tokens before LP creation. Its selected token becomes permanent after activation. Funds can remain locked indefinitely if token launch or matching deposits never happen. The timelock and locked LP tokens do not guarantee token quality, price, or protection from owner economic actions. Token economics and TAP conversion stay TBA.

## Prepare the mainnet deployment

```sh
npm ci
npm run contracts:build
npx tsx scripts/nft-deploy.ts plan --owner YOUR_PUBLIC_WALLET
```

This makes a **read-only** mainnet preflight, verifies deployed dependencies, estimates gas for the complete transaction and writes [the exact deployment plan](deployment-plan.json). No private key is requested or exported. The plan contains public constructor arguments, predicted addresses, compiler version, init-code hashes and exact calldata.

All four deployments fit into one `aggregate3` call to the existing Multicall3 contract, with `allowFailure=false` for every step. Each step invokes the canonical CREATE2 deployer; constructors set the selected owner explicitly. A failure reverts the entire bundle. Front-running the same exact deployment cannot change the owner or immutable economics. Runtime and init-code sizes are checked against mainnet limits. The collection opens at deployment; the owner can pause it.

The original contracts use pinned OpenZeppelin 5.4.0, Solidity from the lockfile, optimized via-IR and the Paris EVM target. Keep the exact lockfile and generated renderer for reproducible bytecode. `contracts/NibRenderer.sol` is generated from the original artwork using `npx tsx scripts/generate-nft-renderer.ts`; tests compare its deployed SVGs byte-for-byte with website previews.

## Binance preview and approval

With the official `baw` CLI connected, Node proxy/CA trust configured normally, and Developer Mode active:

```sh
npx tsx scripts/nft-deploy.ts preview --owner YOUR_PUBLIC_WALLET
```

Show the owner the exact deploy operation, parsed Binance preview, all risks/authority changes and gas estimate. The full preview is stored privately under `~/.local/state/taptap/nft-deployment-preview.json`; no wallet keys are included. A preview is not a deployment and expires quickly.

**Only after explicit approval of that exact preview:**

```sh
npx tsx scripts/nft-deploy.ts execute --approve-deployment
```

If Binance rejects the aggregate preview while BNB RPC simulation succeeds, the script falls back to the first undeployed component without setting a custom gas cap. You can also request an explicit stage:

```sh
npx tsx scripts/nft-deploy.ts preview --owner YOUR_PUBLIC_WALLET --component NibRenderer
```

After that transaction is approved, mined and verified, run `preview` again. Already deployed components must match reviewed runtime bytecode and are excluded from the next stage. Each new stage has its own exact parsed preview, fee estimate and approval. No funds move when a preview fails. The first live Binance renderer preview succeeded after the full-bundle preview was rejected; the fallback is implemented and tested.

The script journals before calling Binance and will not automatically repeat an attempted deployment. If Binance requests app confirmation, the owner must complete it. Recover the transaction hash from Binance and inspect its receipt before proceeding. Never re-execute an uncertain deployment. Execution spends BNB network gas; native transfer value is zero, and deployment does not mint NFTs, grant USDT allowances or deploy the future token.

After successful chain confirmation:

```sh
npx tsx scripts/nft-deploy.ts verify --owner YOUR_PUBLIC_WALLET
```

This checks all four deployed runtime bytecodes (normalizing compiler-recorded immutable references), ownership and cross-contract links against the reviewed plan. Publish source verification on BscScan/Sourcify using the exact compiler settings and constructor arguments. Do not describe contracts as independently audited.

## Activate the website

After receipt and runtime verification, set these public-address environment variables on the existing Vercel **production** project:

- `NFT_COLLECTION`: verified `NibCollection` address.
- `NFT_MARKETPLACE`: verified `NibMarketplace` address.
- `NFT_MARKETPLACE_FROM_BLOCK` (optional): first block to scan for the Recent sales index (defaults to the known mainnet deploy block).
- `NFT_LOGS_RPC_URL` (optional): RPC used only for `eth_getLogs`. BNB's `bsc-dataseed` nodes reject log queries, so without this the sales index tries `NFT_RPC_URL`, `BSC_RPC_URL`, then a public node.
- `NFT_LP_VAULT`: verified `NibLPVault` address.
- `NFT_COLLECTION_BIDS`: verified `NibCollectionBids` address (collection-wide bids). Leave unset until the contract is deployed and `scripts/nib-collection-bids-deploy.ts verify` passes. While unset the market tab hides the feature, the API reports `collectionBids.configured=false`, and requests are refused. The API also cross-checks the contract's collection, Agent ID registry, fee rates and fee recipient (it must equal the marketplace's) before enabling it.
- `NFT_FEE_RECIPIENT`: optional, must match the marketplace’s immutable recipient; defaults to the LP vault. For a treasury, supply the same public address to deployment planning, preview, and verification with `--fee-recipient ADDRESS`, then set this environment variable. Changing the recipient changes the marketplace’s CREATE2 address and requires a new preview. Trading fees never increase primary mint prices.

Redeploy the exact GitHub commit. The API verifies chain 56, payment token, registry, price, cap, wallet limit, vault/router/WBNB, Chainlink BNB/USD feed and native-market/collection links before enabling NFT actions. Missing configuration shows an honest deployment-pending gallery with disabled minting/trading. Incorrect contracts fail closed. Apply the additive Drizzle migrations through the existing build pipeline.

## Agent protocol and recovery

Browser requests queue in `nft_intents`. Signed game-key actions coordinate claim → preview → approval consumption → broadcast → receipt. Only the wallet-owning browser can approve a preview, binding the exact transaction digest and Binance request ID. The runner also requires its matching local preview journal and validates the contract/function/amount/token/price/deadline before a main-wallet call.

The main wallet, not the game key, signs fund-moving transactions. Token approvals are exact amounts and NFT approvals are individual token IDs. Receipts must match sender, target, calldata, exact approved native BNB value, success and three confirmations. Only confirmed receipts reserve the unique transaction hash; an attacker cannot block another wallet by posting an unverified hash. Ordinary failures are restricted to stages before submission. Unknown outcomes require receipt recovery rather than retry. A known disconnected-wallet failure is checked before consuming the approval.

Browser cancellation and disconnect cancel pre-submission requests only. An in-flight blockchain transaction or an existing token allowance needs Binance/on-chain management. Keep the connector's restrictive local state file through restarts; it contains the game-only key and execution journal and must never be published.

## Later LP operation

After token economics are decided, the owner calls `proposeToken`, waits two days, then `activateToken`. Deposit matching token units into the vault and review an owner-signed `addLiquidity` call with explicit desired amounts, nonzero minimums and a deadline of at most 30 minutes. Use `addLiquidity` for token/USDT or `addLiquidityBNB` for token/WBNB. Both asset approvals to the router are cleared after addition. LP tokens remain locked in the vault. These future actions are not part of this NFT deployment approval.

## Website image previews

Gallery, Mint and Market images use `/api/nft/preview/v2/ID.png`, a stateless Node route rendering the original SVG with a bundled monospace font. It returns cached, opaque 560×560 PNGs without session cookies. The original `/api/nft/art/ID.svg`, metadata and Solidity renderer are unchanged. The legacy Worker route redirects these image requests to the public Vercel image service. Explicit browser/OS image-inversion settings can still override any website.

## Marketplace fee and bid release

Buyer fee: 200 bps added to base price. Seller fee: 200 bps deducted from base price. Each rounds down to wei. The immutable recipient gets their sum at settlement. The user selected the connected agent wallet `0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d` as the trading-fee treasury. The current unsigned plan fixes fees to that address. Use `--fee-recipient 0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d` when planning, previewing and verifying, and set production `NFT_FEE_RECIPIENT` to that same address after deployment verification. The CLI default remains the LP vault for plans without an explicit recipient. Exact mainnet transactions must still be reviewed before execution.

Bids escrow the exact buyer total, bind the current NFT owner, and expire within 30 days. They require no listing or NFT approval to place. Acceptance requires current ownership, both Agent IDs, individual NFT approval, and exact bidder/price/deadline. NFT approval and acceptance use separate browser approvals. Cancellation/pruning credits the full deposit; refund withdrawal is a separate reviewed call, not an automatic expiry action. Refund and cancellation exits have no identity gate. Escrow and refund accounting are independent of trading fee accounting.

No contracts were deployed or wallet funds spent by this release. Existing inactive contract settings must remain unset until a new exact deployment preview, approval, receipt and runtime verification are complete.

## Collection-wide bids (`NibCollectionBids`)

One bidder escrows BNB for N NFTs at price P each plus the 2% buyer fee (`N × (P + floor(P·2%))`, each rounded down to wei per NFT, identical to `NibMarketplace.quote`). Expiry is at most 30 days. Any holder of any collection token with an Agent ID can sell one NFT per transaction and receives `P − floor(P·2%)`; the two 2% fees go to the immutable fee recipient (the treasury, the same recipient as the marketplace). Each fill decrements the remaining quantity; the last fill closes the bid. The bidder can cancel at any time (also after expiry or a partial fill) and the unfilled remainder, including its buyer fees, is refunded in the same transaction to a recipient the bidder names. There is no owner, pause, upgrade or rescue path. All state changes happen before the external NFT transfer and BNB payouts and every entry point is `nonReentrant`.

- Contract: `contracts/NibCollectionBids.sol`; reviewed artifact and verification input: `artifacts/NibCollectionBids.json`, `artifacts/NibCollectionBids-standard-input.json` (rebuild with `node scripts/compile-collection-bids.mjs`; it is excluded from the joint `compile-contracts.mjs` so existing artifacts stay untouched).
- Deployment: `npx tsx scripts/nib-collection-bids-deploy.ts plan|dryrun|preview|execute|verify`. `plan` and `dryrun` are read-only. `execute` requires `--approve-deployment` after the user approves the exact preview. The address is deterministic (CREATE2), so the connector pins it.
- Chat commands: `do nft-collection-bid --bnb P --qty N [--days D]`, `do nft-collection-accept <bidId> <tokenId>`, `do nft-collection-cancel <bidId>`, `do nft-collection-book`. All keep the preview then `execute --approve` flow; selling needs the usual one-NFT approval first.
- Site: the market tab shows the collection-bid section only when `NFT_COLLECTION_BIDS` is configured and validated.
