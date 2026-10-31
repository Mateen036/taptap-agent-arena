# TapTap Agent Arena — Project Handoff (for agents)

Updated: 2026-10-31 (PKT). Owner: Mateen Abbas (GitHub Mateen036).

## Live
- Site: https://www.nibtap.site (Cloudflare Worker `nibtap`, branch `cloudflare`, deploy with `npx wrangler deploy` from `deploy/cloudflare`). Apex 301 -> www.
- DB: Neon Postgres (Launch plan). Domain at GoDaddy, DNS on Cloudflare.

## Contracts (BSC mainnet)
- Treasury / owner: 0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d (Binance agentic wallet; txs need owner approval in Binance app)
- NIB Token: 0x1F11d9feAF354aD31861B4fa26759349e2860cFb (1B supply, 18 dec, verified on Sourcify)
- NibAirdrop: 0x3F5C83b4a24f0D12A278E995F21c0DEb9a8524d5 (Season 1 open: 400M NIB, 10 TAP = 1 NIB)
- NibCollectionV2: 0xdA35ed11057Cd85Eb338a637f5509080F617a810 ($0.05 mint, 3 free + 7 paid per wallet, max 8,826)
- NibMarketplace V2: 0x0233900626a04a79f1E3f1A58b989dCa67c1C392
- NibCollectionBids V2: 0x6Fa70911C8eCF6F869789f114Cc2bed445933a6B
- NibVaultV2 (fees, treasury-withdrawable): 0x65397BF634E817539024EFd32a0E2c5e51fB81bd
- NibBidMarket (NIB pre-market): 0x775377BAdf400F070024b2C806A2573461b5dCb7
- NIB/WBNB PancakeSwap V2 pair: 0xD98132535fA350c23a26b22C6a77678F99094BB9 — launched with 50M NIB + 0.0169 BNB, 100% LP burned to 0x...dEaD
- Old NibLPVault (V1): 0x45dB592E...C84D8B — holds small WBNB/USDT, TEST token activatable ~Nov 2

## Brand
- Mascot/logos: public/brand/nib-mascot.png, nib-logo-{32.svg,64.png,256.png}

## In progress / not deployed
- Bug bounty (branch `bug-bounty`, commit 73869ef): 2% fee, min 10,000 NIB, hunters stake TAP, appeals w/ owner override, reviewers get 20% of payout.
  - NEW RULE not yet implemented: verdict needs >= 6 reviewer agents agreeing; only those split the 20%.
  - Contract near 24,576-byte limit. Branch conflicts with `cloudflare` in 4 files. Not deployed.
- BscScan token info update (logo + description): needs signature from treasury (deployer via CREATE2 factory) and BscScan source verification check.

## Rules for agents
- Never send a transaction, transfer funds, or approve tokens without showing a preview and getting the owner's explicit yes.
- Never print or commit secrets.
- Commit as `Mateen036 <92680735+Mateen036@users.noreply.github.com>`; never a bot email.
- BSC RPC: https://bsc-dataseed.bnbchain.org
