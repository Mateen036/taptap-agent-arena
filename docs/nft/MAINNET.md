# BNB mainnet deployment

Status: prepared and simulated with read-only RPC; no deployment transaction has been submitted by this plan.

Owner and selected trading-fee treasury: `0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d` (the connected Binance Agentic Wallet on BNB Chain, chain 56).

| Component | Predicted CREATE2 address |
| --- | --- |
| renderer | `0xD056d8A5DBA90620452fa3E6236c8AdE27F21465` |
| vault | `0x45dB592E5F5D2a591b8FE9bdCfb75e6b1fC84D8B` |
| collection | `0x7374f0379F5b2689B906D47Da708B394F1910B23` |
| market | `0x8B1434193028A88d2a501a88eFc66F4678EF6F02` |

Marketplace fees are fixed at 2% buyer + 2% seller and paid directly to this treasury. Primary mint payments still go to the LP vault. The collection, renderer, fees and LP rules are immutable except for the explicitly documented owner controls.

All four predicted addresses were empty when preparing this plan. The full bundle was estimated at 9825440 gas, or approximately 0.000491272 BNB at the observed gas price. This is an estimate, not a spending cap. Binance may require staged deployment; every stage must have its own successful preview and approval.

After each submitted transaction, verify its receipt and runtime code before proceeding. After all components are deployed, verify constructor links, owner, price feed, both fee rates and exact treasury; then configure production addresses and `NFT_FEE_RECIPIENT`, open minting via a separately reviewed owner call, and follow the NFT utility activation procedure. Do not configure undeployed addresses or claim that trading is live before activation.

Unsigned calldata and constructor arguments: [deployment-plan.json](deployment-plan.json).


## Nib Collection V2 (planned, nothing deployed)

Treasury-owned CREATE2 deployments through `scripts/nib-collection-v2-deploy.ts` (`plan` prints the exact addresses; the values depend on the old collection's final `minted()`, currently 1187, so `publicStartId` = 1188). Deploy NibVaultV2 first, then `--step 1` NibCollectionV2, `--step 2` NibMarketplace (V2), `--step 3` NibCollectionBids (V2). Planned addresses with publicStartId 1188:

| Component | Predicted CREATE2 address |
| --- | --- |
| NibVaultV2 | `0x65397BF634E817539024EFd32a0E2c5e51fB81bd` |
| NibCollectionV2 | `0xdA35ed11057Cd85Eb338a637f5509080F617a810` |
| NibMarketplace (V2) | `0x0233900626a04a79f1E3f1A58b989dCa67c1C392` |
| NibCollectionBids (V2) | `0x6Fa70911C8eCF6F869789f114Cc2bed445933a6B` |

Each transaction needs its own preview and explicit approval. Airdrop and bonus batches are separate approved transactions, followed by `finalizeAirdrop()` and `setMintOpen(true)`.
