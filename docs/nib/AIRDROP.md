# NIB token + airdrop

Contracts: `contracts/NibToken.sol`, `contracts/NibAirdrop.sol`. Tests: `test/nib-airdrop.test.ts`. Status: written and tested locally, NOT deployed.

## Token
ERC-20 "NIB Token" / "NIB", 18 decimals, 1,000,000,000 minted once in the constructor: 800M to the airdrop contract, 200M to the treasury (for LP pairing). No owner, mint, burn, pause, tax, blacklist or team allocation.

## Airdrop
* 5 seasons. S1 = 400M. S2-S5 default 100M each; S2-S4 configurable only while Unopened, S5 takes the remainder so the total is always exactly 800M.
* Rate stored per season (`pointsPerNib`, default 10 TAP points = 1 NIB), editable only while that season is Unopened.
* Season 1 is first-come-first-served with no per-wallet cap and runs until its pool is empty.
* The owner opens season N+1 only after season N is Ended (pool exhausted, or `endSeason`). Unpaid NIB rolls forward into the next season (`rolledOut` -> `rolledIn`). Season 5 can only end by exhaustion, so nothing is stranded except sub-point dust.
* Claim = EIP-712 `Voucher(wallet, season, cumulativePoints, deadline, voucherId)` signed by the server signer. Pays `(cumulativePoints - convertedPoints[season][wallet]) * 1e18 / rate`. Anyone may relay; NIB always goes to `voucher.wallet`.
* Pool short: pay the remainder, record only the points actually paid for, end the season in the same tx. Claims never revert because of exhaustion.
* No owner withdrawal or sweep of NIB. The only exit is `claim`. Owner powers: rotate signer, pause/unpause, configure unopened seasons, open/end seasons. `renounceOwnership` is disabled; ownership transfer is two-step.
* Deploy order: `NibAirdrop(owner, signer)` -> `NibToken(airdrop, treasury)` -> `airdrop.setToken(token)` (one-time; requires >= 800M NIB held).

## Server side (implemented in lib/airdrop.ts)

Implemented: `GET /api/airdrop`, `POST /api/airdrop/voucher`, signed agent actions `airdrop-state` / `airdrop-voucher`, table `airdrop_conversions` (migration `drizzle/0008_nib_airdrop.sql`), UI panel `public/convert.js`. Settlement is on-demand reconcile (per wallet on every status/voucher call, plus a global sweep of up to 20 expired vouchers): it reads chain block time first, then `convertedPoints`; settles/refunds the unfilled part if the chain shows a claim, or releases (refunds in full) once block time is more than 60 s past the deadline. No cron or event indexer is required. Env: `NIB_SIGNER_PRIVATE_KEY` (secret), optional `NIB_AIRDROP`, `NIB_TOKEN`, `BSC_RPC_URL`. The design notes below are the original sketch.

Converted TAP must leave the spendable balance, otherwise it can be spent in-game and converted again.

### Ledger
New table `airdrop_conversions(voucher_id pk, wallet, season, cumulative_points, delta_points, deadline, status['pending'|'settled'|'released'], tx_hash, paid_points)`, plus `agents.converted_points` (text, exact-points units) per season (or a separate `airdrop_balances(wallet, season, converted, locked)` table).

### POST /api/airdrop/voucher  { season }
1. `own(env, request)` to authenticate the agent (same session as other endpoints).
2. `gameAccess(env, a.wallet)`; require `canPlay` (Agent ID + NFT). Reject otherwise (403 as `requireGameAccess`).
3. Require the season to be open: read `currentSeason`/`seasons(n).status` from the chain (cache a few seconds). Stop issuing when the pool is empty.
4. Compute `convertible = pointBalance(a)` (whole points, floor; exact/NFT-multiplied units mapped via `publicPoints`). Reject if below a minimum (e.g. 10 points).
5. In ONE atomic `cas()` batch guarded by `agents.last_event`: deduct `convertible` from `points_exact` (earned stays untouched so ranking is unaffected), add to a `locked` amount, insert the `pending` conversion row with a fresh `voucher_id` and `deadline = now + 15 min`.
6. Sign the voucher with the server key: `cumulativePoints = onchainConverted + pendingLocked + convertible` where `onchainConverted` is read from `convertedPoints(season, wallet)`. Return `{voucher, signature}`.
Only one pending voucher per wallet+season at a time (re-issue returns the existing one) so cumulative accounting stays unambiguous.

### Settlement
Index the `Converted(wallet, season, pointsConverted, nibPaid, totalPointsConverted, partialFill, voucherId)` event (poller or webhook):
* Settled: mark the row settled; if `pointsConverted < delta_points` (partial fill at exhaustion), refund the difference to the agent's `points_exact`.
* Expired: when `deadline` passes and no event (and `convertedPoints` on chain unchanged), mark released and refund the locked points. Do this lazily at the next `/voucher` or `/state` call, after re-reading on-chain `convertedPoints` to avoid a race with a late claim; keep a margin (deadline + a few blocks).
* On season rollover the off-chain converted counter is per season, so points convert again only if the player earned new ones (vouchers are per season).

### Hardening
Signer key in a secret store (separate from deployer key), per-wallet and global rate limits, log every signature. A leaked signer can drain the open season FCFS; mitigations are `pause()`, `endSeason()`, `setSigner()`.

## Deployment (via baw agent wallet, owner = treasury 0x0D96…eC0d)
`npx tsx scripts/nib-deploy.ts plan|preview|execute|verify --step N`. Uses the CREATE2 factory so addresses are known up front. Signer key lives only in `/workspace/secrets/nib_signer.txt` (chmod 600); only its address is ever printed. `execute` refuses to run without `--approve-deployment`, an unexpired preview, matching calldata hash, and on-chain preconditions (step 2 needs step 1 deployed, step 3 needs the funded token). Run `verify` after step 3.

## NFT holder bonus (implemented, no contract change)
One-time 10,000 NIB per Nib NFT token id, credited as 100,000 convertible TAP (10 TAP = 1 NIB) and then converted through the normal voucher flow. `POST /api/airdrop/nft-bonus` / signed action `airdrop-nft-bonus` claims every unclaimed NFT the wallet currently holds (read from the collection `0x7374…0B23` with `balanceOf`, `tokenOfOwnerByIndex`, confirmed by `ownerOf`). Rules, all enforced in one atomic batch: season 1 must be open on-chain; `nft_bonus_claims.token_id` is the primary key so a token pays once, ever; the guard `SUM(amount)+new <= 2,000,000,000` caps total bonus at 200M NIB; the balance update is guarded by the agent version, so points, ledger row (`nft-bonus`) and per-token rows commit together or not at all. Only `points` rises; `earned` is untouched so rankings are unaffected. Caveat: the bonus is not segregated from other TAP and the 200M earmark is not enforced on-chain, so season 1 stays first come, first served and bonus TAP left unconverted can be converted in a later season.
