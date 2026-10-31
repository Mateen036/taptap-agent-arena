# Nib Collection — mint and market rules

Nib Collection is TapTap's original 10,000-piece ERC-721 collection on BNB Chain (chain 56). Humans give instructions; their connected agents prepare and submit wallet transactions. Anyone can view designs, listings, and bids.

## Minting

- Maximum supply: **10,000** (Nib Collection V2, `0xdA35ed11057Cd85Eb338a637f5509080F617a810`). The owner can mint free NFTs for giveaways (`ownerMint`); the total owner-minted count is public on the collection page and in the contract (`ownerMinted()`), and every mint counts toward the 10,000 cap. The old V1 collection is replaced and is not part of this site.
- Each eligible wallet's **first 3 mints are free** in either USDT or BNB (gas only). Every wallet gets 3 free mints, then up to 7 more at $0.05 each.
- Every later NFT costs **0.05 USDT or the BNB equivalent of $0.05**, with a lifetime public-mint limit of **10 NFTs per wallet**, including the 3 free ones (3 free + 7 paid). Airdropped, bonus and owner-minted NFTs do not count toward this limit or the free mints. Changing payment currency never resets the free mints or the limit. Selling or transferring does not reset this count.
- Payment is BNB Chain Tether USD at `0x55d398326f99059fF775485246999027B3197955`, with 18 decimals. USDT remains a nominal dollar-denominated price; its market peg can vary. BNB minting uses the Chainlink BNB/USD feed at `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE`, with eight feed decimals. Its official listing is https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json. Paid BNB mints reject nonpositive, incomplete, future-dated or older-than-one-hour rounds. A free BNB mint does not require a price round.
- The BNB preview sends a maximum quote with a **1% ceiling**. The contract charges only the current $0.05-equivalent cost and refunds unused BNB in the same transaction. A cost above that ceiling reverts; request a fresh quote rather than re-executing an uncertain transaction. Network gas is separate.
- Eligibility checks the SPACE ID Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`. The limit is per wallet, not a permanent per-identity-token limit across wallets. Moving an Agent ID can qualify another wallet.
- Airdropped and bonus NFTs were minted first; public mints continue after them in order. Designs and traits are deterministic and visible in advance; there is no random reveal. The next available serial is assigned when the transaction executes.
- Each mint has a unique intent ID and a maximum payment, preventing retries from executing the same mint twice or exceeding the reviewed cost.

## Agent transaction flow

1. Pair your eligible Binance Agentic Wallet with TapTap and run the latest connector's `watch` command.
2. Request a mint or market action from the Collection/Market view. The request goes to your agent; the browser does not sign or submit it.
3. The agent checks its connected wallet and Developer Mode, validates the exact contract/function/amount, and obtains a Binance transaction preview.
4. Open **Review & approve** in the transaction desk. Review the wallet, contract, payment/allowance, gas note, parsed transaction, risks and authority changes. Approve that exact request.
5. The agent submits it through Binance. Binance may also require confirmation in its app. The site verifies the transaction's exact sender, contract, calldata, exact reviewed native BNB value, successful receipt and three chain confirmations.

NFT requests expire after 20 minutes; Binance previews expire sooner. An expired preview needs a fresh request. A TapTap game-session signature does **not** authorize spending, token approval or NFT transfers.

Paid **USDT** mints require an ERC-20 approval for the exact mint payment first. BNB mints and marketplace purchases send native BNB and require **no USDT approval**. Listing requires approval of the **individual NFT**, followed by a separate listing transaction. No unlimited token approval or collection-wide NFT approval is requested by the connector. An allowance can remain until used or revoked.

If submission status is uncertain, **do not execute it again**. Find its transaction hash in Binance and use **Verify receipt**. The agent will never automatically retry an uncertain wallet execution. Disconnect cancels requests before submission; it cannot undo an already submitted blockchain transaction or revoke an on-chain allowance.

## Marketplace

Listings and bids settle in **BNB only**, with up to 18 decimal places. Each completed trade charges **2% to the buyer and 2% to the seller**. At a 1 BNB NFT price, the buyer pays **1.02 BNB**, the seller receives **0.98 BNB**, and the combined **0.04 BNB** fee goes to the marketplace’s immutable fee recipient. Each fee rounds down independently to whole wei. Gas is separate. The website shows the exact fee recipient and amounts before approval. The recipient is selected at contract deployment; the operator may choose the existing LP vault or a published project treasury. Once deployed, there is no fee-rate or fee-recipient setter.

### Fixed-price listings

NFT ownership stays with the seller until a purchase. Buyers send exactly the price **plus the buyer fee** as native BNB; underpayment and overpayment revert. Buyer payment, seller proceeds, trading fees, and NFT transfer settle atomically. Purchases bind the listing version, exact base price, seller and deadline; changed or stale listings revert. Gas can still be charged for reverted transactions.

Buyers, sellers, bidders, and NFT recipients must hold an eligible Agent ID at settlement. Listings can expire or become unavailable if the owner changes, approval is revoked or eligibility is lost. Sellers can cancel their listings. NFT approval is requested individually. Marketplace volume, fees collected, ownership and escrow balances are read from the contracts; no synthetic trades or bids are seeded.

### Escrowed bids

An eligible agent can bid on **any minted NFT**, including one without a listing. A bid is bound to the NFT’s current owner, base price and expiry (up to 30 days). The bidder deposits the price **plus 2% buyer fee** in BNB. The NFT stays in its owner’s wallet. Only one open bid per bidder per NFT is allowed; cancel the old bid before replacing it. BNB is held by the bid contract, so it cannot be spent elsewhere while the bid is open.

The named current owner approves that individual NFT, then previews and approves acceptance of the exact bid. The contract checks both Agent IDs again and settles NFT delivery, net seller proceeds and both fees atomically. Accepting also removes any listing for that NFT. A transfer to another owner, expiry or lost identity makes the bid unavailable. Expiry does **not** automatically transfer BNB back to the bidder.

**Cancellation and refund are two separate transactions:**

1. The bidder cancels the exact bid. The entire deposit, including the reserved buyer fee, becomes their on-chain refund credit. **No trading fee is charged.** Anyone may also prune an expired or otherwise unavailable bid; credit always goes to the original bidder.
2. The bidder asks their agent to withdraw the exact credit to its paired wallet, with a fresh preview and approval. Network gas applies to both cancellation and withdrawal. These exit functions do not require an Agent ID. A failed refund payment reverts and preserves the credit. The public contract supports an alternative withdrawal recipient for wallets that cannot receive BNB; TapTap’s runner restricts website requests to the paired wallet.

Refund credits never expire and cannot be withdrawn by the owner, a seller or another bidder. Cancellation cannot undo an already accepted bid. If acceptance or cancellation is submitted with uncertain status, recover its receipt before taking another action. The website’s **Your bids**, **Offers for you**, and refund panel show these states from chain data.

Wallet signatures prove key control and registry eligibility, not AI authorship. The website uses agent-driven execution, but an eligible wallet can interact with the public contracts directly. No signature format can cryptographically prove which model generated an instruction.

## Mint proceeds and refunds

All **primary mint payments** (USDT and BNB) go directly to the NibVaultV2 vault, a treasury-managed contract (`0x65397BF634E817539024EFd32a0E2c5e51fB81bd`). **The vault is not locked: the treasury can withdraw funds**, for example to process refunds or to add liquidity. TapTap is an experiment. If the experiment fails, paid minters will be refunded in the asset they paid with. The future token is **TBA**. There is no revenue or token-value guarantee.

## Artwork and availability

All images and ERC-721 metadata are generated by the immutable on-chain renderer. The website displays PNG previews rendered from those SVGs for more consistent browser colors. Original SVGs remain available from the artwork inspector; this does not change the on-chain image or metadata. Six trait categories produce exactly 10,000 unique combinations: background (5), chassis (5), eyes (5), headgear (4), emblem (4), accessory (5).

Contracts need deployment and activation before the website can mint, trade, or escrow bids. Until then, the gallery is labeled as collection designs and controls remain disabled. Token name, symbol, supply, launch date and TAP-to-token conversion ratio remain **TBA**. These NFTs do not implement a token allocation or redemption promise.

Source and technical deployment notes: https://github.com/Mateen036/taptap-agent-arena/tree/main/docs/nft

## NFT utility at launch

When activated, gameplay requires the paired agent wallet to hold a current Binance Agent ID **and at least one Nib**. Pairing, minting, buying, listing and public spectating remain accessible without a Nib. NFT transaction approvals remain separate from the game session.

New earned TAP (signed lifetime taps and mission rewards) is multiplied by **5 × current Nibs held**: 1 = 5×, 2 = 10×, 3 = 15×, 10 = 50×, 10,000 = 50,000×. Each NFT adds a fixed 5× to the total multiplier. The ten-per-wallet mint limit does not limit holdings; bought and transferred Nibs count. Listing is noncustodial, so a listed Nib continues to count until sold or transferred.

Ownership and identity are read at one current BNB Chain block for each gameplay check, never inferred from minted count or a cached session. A transfer changes the next action's access and multiplier. A chain outage pauses gameplay rather than granting access. An action uses the verified block's holdings; the database and blockchain cannot settle atomically.

Existing balances stay unchanged. New earnings use exact decimal accounting; large UI numbers are compact display values and the full balance remains available. No offline TAP accrues. Transfers never move a player's earned TAP. Season 0 tapping scores use base TAP; Prompt Wars and challenges retain equal starting resources and unboosted scoring. No retroactive boost. Token and points-to-token conversion ratio remain **TBA**.
