# Marketplace fees and bids — verification

The flow is: website request → signed agent task → exact Binance transaction preview → browser approval → contract execution → confirmed receipt → refreshed ownership, fee and escrow state.

The browser and signed API tests use disposable local EVM wallets and synthetic Binance previews. They do not establish that Binance will approve or sign a mainnet transaction for a user’s wallet. No user wallet signatures, mainnet deployments, or mint payments were requested by these checks.

## Implemented rules

- Buyer fee: **2% added to the base price**. Seller fee: **2% deducted from the base price**. Immutable constants; each fee rounds down to whole wei.
- The immutable fee recipient receives both fees at settlement. The user selected the connected BNB agent wallet `0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d` as the project treasury. The current unsigned deployment plan fixes marketplace fees to that address. A treasury is selected with `--fee-recipient ADDRESS`. `NFT_FEE_RECIPIENT` must match the deployed contract; it defaults to the configured LP vault.
- Listings leave the NFT in the seller’s wallet. Exact purchase total, NFT delivery, net seller payout and fee transfer all succeed together or revert.
- Bids escrow the base price plus the buyer fee, name the current owner, expire within 30 days, and require no listing. One open bid per bidder per NFT.
- Acceptance requires the named current owner, both current Agent IDs, NFT approval, exact bidder and price, and an unexpired deadline. It clears both the accepted bid and any listing for the NFT.
- Cancellation or pruning credits the **entire** deposit to the bidder. A separate reviewed withdrawal returns that credit. No trading fee on cancellation. Expiry alone does not return funds.
- Cancel/refund exits do not require an Agent ID. Refund credit has no expiry. Failed transfers revert without consuming the credit or escrow. No admin withdrawal or fee setter exists.
- Primary mint rules, token/points conversion TBA, linear 5× NFT utility and equal competitive scoring are unchanged.

## Verified boundaries

| Boundary | Evidence |
| --- | --- |
| Website → API | Chromium submits listing, buy, bid, cancellation, refund and acceptance requests with exact terms. The UI displays both fees before approval. |
| API → agent | Signed SQLite and Postgres flows bind amounts, contract, calldata, deadline, bid/listing IDs and preview digest. Tampered amounts, bidders and withdrawal recipients are rejected by the runner. |
| Approval → execution | Browser approval is consumed once; signed receipts must match sender, destination, native value and calldata. Existing uncertain-submission recovery remains enforced. |
| Contract → balances | A 0.002 BNB purchase transfers 0.00204 BNB from the buyer, pays 0.00196 BNB to the seller and sends 0.00008 BNB in fees to the recipient. |
| Contract → bid refund | A 0.001 BNB bid escrows 0.00102 BNB. Cancellation credits all 0.00102 BNB; withdrawal clears the credit. This also passes after the bidder loses its Agent ID. |
| Acceptance → NFT access | Accepting a second 0.003 BNB bid delivers the second NFT, pays 0.00294 BNB net, gives the buyer 2 NFTs/10×, and locks the now NFT-less seller out of gameplay. |
| Failure → rollback | Wrong payment, expired bids, ownership changes, duplicate bids, stale acceptance, failed NFT delivery, failed seller/fee payout and failed refund receivers preserve the appropriate ownership and balances. |
| Escrow accounting | Actual marketplace BNB balance equals open bid deposits plus outstanding refund credits throughout contract scenarios. Fees are accounted separately and do not consume other bidders’ deposits. |

Validation: **50 automated contract/API tests**, **nine Chromium browser flows**, TypeScript checks, contract compilation and Vercel production build pass locally. The updated marketplace runtime is 9,821 bytes, below the 24,576-byte limit. The refreshed mainnet deployment plan is unsigned and only estimated using read-only RPC.

Mainnet NFT contracts are still awaiting deployment and activation. Website controls remain disabled until the reviewed contracts are configured. This release does not activate trading or collect fees on mainnet.
