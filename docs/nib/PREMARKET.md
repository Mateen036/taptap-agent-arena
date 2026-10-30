# NIB pre-market (bid-only)

`contracts/NibBidMarket.sol`, a permissionless, ownerless escrow order book for NIB, modelled on the NFT marketplace's bid system.

## Rules

* **Bids only.** A buyer calls `placeBid(nibAmount, bnbAmount, expiresAt)` and locks `bnbAmount + 2%` in BNB. The price is `bnbAmount / nibAmount`, chosen by the buyer. There is no listing function: a holder sells only by calling `acceptBid(id, nibAmount, minBnbOut, deadline)` on an existing bid, in full or in part.
* **Fees (2% + 2%, paid to the treasury `0x0D96…eC0d`, the same convention as `NibMarketplace`).**
  * Buyer: escrows price + 2% of price. The 2% is pre-paid at placement and consumed pro-rata as the bid fills.
  * Seller: receives price − 2% of price, deducted from the BNB at settlement.
  * The treasury therefore receives 4% of the filled notional. Cancelling is free: the unfilled BNB and its unspent 2% fee are refunded in full. Gas is paid by whoever sends each transaction (bidder: place/cancel; seller: approve + accept).
* **Settlement** is atomic in `acceptBid`: NIB moves `seller → bidder` with `transferFrom` (seller approves the market first), then BNB is paid to the seller and the fees to the treasury. A partial fill takes floor pro-rata BNB and fee; the final fill takes the exact remainder, so no wei is ever stranded and the buyer never pays more than they escrowed. The seller's BNB rounds down, so they never receive more than the bid price. Fills that would pay 0 BNB are rejected.
* **Limits.** Minimum bid 0.001 BNB (notional, fee excluded), at most 1e9 NIB and 1e6 BNB per bid, optional expiry up to 365 days. Self-accept is rejected. `minBnbOut` and `deadline` protect the seller from stale or changed bids.
* **No owner.** No withdraw, upgrade, rescue or fee-setting function exists. The treasury can only call `setPaused`, which blocks `placeBid` only; `acceptBid` and `cancelBid` always work, so escrow can always be refunded.
* **Safe payouts.** BNB payouts use a 100k-gas capped call; if a receiver rejects, the amount is credited and can be pulled with `withdrawCredit`, so a hostile bidder, seller or treasury cannot block fills or cancels. State is updated before any external call, and every state-changing entry point is `nonReentrant`. Invariant: `address(this).balance == totalEscrow + totalCredits`.
* **Not an AMM, no price oracle, no transfer tax assumptions**: NIB is the fixed-supply, tax-free token.

## Gas (Ganache measurements)

placeBid ≈ 275k · acceptBid (full fill) ≈ 179k · cancelBid ≈ 70k. Deployment ≈ 1.73M gas via CREATE2 (≈ 0.00009 BNB at 0.05 gwei).

## Slither

`PREMARKET-slither.txt`: 12 results, none exploitable. `reentrancy-eth` / `reentrancy-benign` are in `_pay`, where credit accounting after a failed capped call is by design (the bid is already settled and the function is `nonReentrant`); `timestamp` (expiry), `low-level-calls`, `return-bomb` (the call is capped to 100k gas) and `unused-return` are informational.

## Website and agents

* `GET /api/nib-market` is public: top bid, bids (best price first), levels with cumulative depth, stats, recent fills (`BidAccepted` events) and, for a connected agent, its bids/NIB balance/allowance/credit. It returns `{deployed:false,…}` until `NIB_BID_MARKET` points at a contract.
* Signed agent actions: `nib-market-state`, `nib-bid-place`, `nib-bid-cancel`, `nib-bid-accept`. They return `baw contract-call preview` commands; nothing is sent without the user's approval (`public/agent-skill.md`, "NIB pre-market").
* Gating follows the existing convention: place and accept require game access (`requireGameAccess`: Agent ID + NFT when utility is active); cancel and state are never gated so exits stay open. The contract itself is permissionless.
* Env: `NIB_BID_MARKET` (contract), `NIB_MARKET_FROM_BLOCK` (deployment block, for fill history). `NIB_TOKEN` is optional (defaults to the live token).

## Deployment

`npx tsx scripts/nib-market-deploy.ts plan|preview|execute|verify`: one CREATE2 deployment (`NibBidMarket(NIB, treasury)`) from the treasury wallet via baw. `execute` needs `--approve-deployment`, an unexpired saved preview, the connected treasury wallet and an unchanged calldata hash. Address: `0x775377BAdf400F070024b2C806A2573461b5dCb7`.
