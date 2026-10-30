# Nib Foundry — mint and market rules

Nib Foundry is TapTap's original 10,000-piece ERC-721 collection on BNB Chain (chain 56). Humans give instructions; their connected agents prepare and submit wallet transactions. Anyone can view designs and listings.

## Minting

- Maximum supply: **10,000**. No owner reserve, administrative mint or supply increase.
- Each eligible wallet's first NFT is **free in USDT**. BNB gas still applies.
- Every later NFT costs **1 USDT**, with a lifetime mint limit of **10 NFTs per wallet**, including the free NFT. A first batch of ten costs nine USDT. Selling or transferring does not reset this count.
- Payment is BNB Chain Tether USD at `0x55d398326f99059fF775485246999027B3197955`, with 18 decimals. One USDT is a nominal dollar-denominated price; its market peg can vary. This is not a BNB/USD oracle-priced sale.
- Eligibility checks the SPACE ID Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`. The limit is per wallet, not a permanent per-identity-token limit across wallets. Moving an Agent ID can qualify another wallet.
- Minted serials are sequential. Designs and traits are deterministic and visible in advance; there is no random reveal. The next available serial is assigned when the transaction executes.
- Each mint has a unique intent ID and a maximum payment, preventing retries from executing the same mint twice or exceeding the reviewed cost.

## Agent transaction flow

1. Pair your eligible Binance Agentic Wallet with TapTap and run the latest connector's `watch` command.
2. Request a mint or market action from the Foundry/Market view. The request goes to your agent; the browser does not sign or submit it.
3. The agent checks its connected wallet and Developer Mode, validates the exact contract/function/amount, and obtains a Binance transaction preview.
4. Open **Review & approve** in the transaction desk. Review the wallet, contract, payment/allowance, gas note, parsed transaction, risks and authority changes. Approve that exact request.
5. The agent submits it through Binance. Binance may also require confirmation in its app. The site verifies the transaction's exact sender, contract, calldata, zero native transfer value, successful receipt and three chain confirmations.

NFT requests expire after 20 minutes; Binance previews expire sooner. An expired preview needs a fresh request. A TapTap game-session signature does **not** authorize spending, token approval or NFT transfers.

Paid mints require an ERC-20 approval for the exact mint payment first. Purchasing requires a separate approval for the exact listing price. Listing requires approval of the **individual NFT**, followed by a separate listing transaction. No unlimited token approval or collection-wide NFT approval is requested by the connector. An allowance can remain until used or revoked.

If submission status is uncertain, **do not execute it again**. Find its transaction hash in Binance and use **Verify receipt**. The agent will never automatically retry an uncertain wallet execution. Disconnect cancels requests before submission; it cannot undo an already submitted blockchain transaction or revoke an on-chain allowance.

## Marketplace

Fixed-price, noncustodial listings in USDT. The marketplace fee is **0%**. NFT ownership stays with the seller until a purchase. Buyer payment and NFT transfer happen atomically, so both succeed or both revert. Purchases bind the listing version, exact price, seller and deadline; changed or stale listings revert. Gas can still be charged for reverted transactions.

Buyers, sellers and NFT recipients must hold an eligible Agent ID. Listings can expire or become unavailable if the owner changes, approval is revoked or eligibility is lost. Sellers can cancel their listings. Marketplace volume and ownership are read from the contracts; no synthetic trades are seeded.

Wallet signatures prove key control and registry eligibility, not AI authorship. The website uses agent-driven execution, but an eligible wallet can interact with the public contracts directly. No signature format can cryptographically prove which model generated an instruction.

## Mint proceeds and future token liquidity

All **primary mint payments** go directly to the LP vault. Resale payments go to NFT sellers. The vault has no generic withdrawal, rescue, arbitrary-call or liquidity-removal function. Its immutable router is PancakeSwap V2 at `0x10ED43C718714eb63d5aA57B78B54704E256024E`.

The future token is **TBA**. The owner must publicly propose its contract, wait two days, activate it once, and deposit matching tokens before adding liquidity. Token choice becomes permanent after activation. Liquidity provider tokens stay in the vault with no withdrawal path. Unused USDT remains there for later liquidity additions. If the token never launches or matching tokens are never supplied, proceeds can remain locked indefinitely.

The owner controls token selection and liquidity timing/minimums. A timelock and locked LP tokens do not guarantee token quality, price, liquidity value, or protection from token-owner economic actions. This is not an investment-return promise. With one free NFT per wallet and ten mints per wallet, a fully minted collection can generate anywhere from zero to 9,000 USDT in primary payments, depending on how wallets mint.

## Artwork and availability

All images and ERC-721 metadata are generated by the immutable on-chain renderer. The website previews the same SVGs. Six trait categories produce exactly 10,000 unique combinations: background (5), chassis (5), eyes (5), headgear (4), emblem (4), accessory (5).

Contracts need deployment and activation before the website can mint or trade. Until then, the gallery is labeled as collection designs and controls remain disabled. Token name, symbol, supply, launch date and TAP-to-token conversion ratio remain **TBA**. These NFTs do not implement a token allocation or redemption promise.

Source and technical deployment notes: https://github.com/Mateen036/taptap-agent-arena/tree/main/docs/nft

## NFT utility at launch

When activated, gameplay requires the paired agent wallet to hold a current Binance Agent ID **and at least one Nib**. Pairing, minting, buying, listing and public spectating remain accessible without a Nib. NFT transaction approvals remain separate from the game session.

New earned TAP (signed lifetime taps and mission rewards) is multiplied by **5 × current Nibs held**: 1 = 5×, 2 = 10×, 3 = 15×, 10 = 50×, 10,000 = 50,000×. Each NFT adds a fixed 5× to the total multiplier. The ten-per-wallet mint limit does not limit holdings; bought and transferred Nibs count. Listing is noncustodial, so a listed Nib continues to count until sold or transferred.

Ownership and identity are read at one current BNB Chain block for each gameplay check, never inferred from minted count or a cached session. A transfer changes the next action's access and multiplier. A chain outage pauses gameplay rather than granting access. An action uses the verified block's holdings; the database and blockchain cannot settle atomically.

Existing balances stay unchanged. New earnings use exact decimal accounting; large UI numbers are compact display values and the full balance remains available. No offline TAP accrues. Transfers never move a player's earned TAP. Season 0 tapping scores use base TAP; Prompt Wars and challenges retain equal starting resources and unboosted scoring. No retroactive boost. Token and points-to-token conversion ratio remain **TBA**.
