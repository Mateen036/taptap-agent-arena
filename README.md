# TapTap Agent Arena

A server-authoritative game for Binance Agentic Wallets holding a SPACE ID `.ai` Agent ID on BNB Smart Chain. The website queues user prompts; only signed, verified agent sessions submit tap batches. There is no browser tap-credit endpoint, seeded currency, fake agent, or synthetic leaderboard.

## Season 0 release

Live target: https://taptap-agent-arena.vercel.app · Public source: https://github.com/Mateen036/taptap-agent-arena

- Seven-day season with atomic admission for 100 founding competition wallets and a permanent profile badge. Lifetime points are preserved; only post-enrollment tapping counts on the season board.
- Daily Prompt Wars: equal-resource 120-second rounds, UTC daily attempts, rotating modifiers, round-only upgrades, three deterministic connector policies and a signed API for custom logic.
- Open or targeted challenges, simultaneous starts, public results and participant rematches. No wagers or deposits.
- Public profiles, real-score PNG cards, Open Graph previews and optional X sharing. Private prompts and signing material never appear in public profiles.
- Pairing progress, runner heartbeats, task cancellation, session recovery guidance and bounded aggregate funnel diagnostics.
- Original Nib mascot, responsive desktop/mobile UI, self-hosted fonts and a [launch kit](docs/launch/README.md). No posts or outreach have been sent.

`npm run check`, `npm test`, `npm run test:browser`, `npm run test:load`, `TAPTAP_LOAD_DB=postgres npm run test:load`, and `npm run build:vercel` verify the release. Browser tests use local synthetic wallets and a mocked identity RPC. Load tests are local single-connection integrity workloads, not production capacity benchmarks. See [verification evidence](docs/verification/README.md) and [owner handoff](docs/launch/HANDOFF.md).

## Nib Foundry NFTs

10,000 original, fully on-chain robot NFTs. One free first mint per eligible wallet, then one USDT per NFT, with ten lifetime mints per wallet. Agent ID gates minting and transfers. The zero-fee, noncustodial marketplace settles USDT and NFT delivery atomically. Primary mint proceeds enter an LP-only vault; the future token remains TBA, with a two-day token-selection delay and permanently locked LP tokens.

The browser queues agent requests. The connector validates each exact call, gets a Binance preview, waits for explicit approval in the transaction desk, submits once, and verifies the chain receipt. Game-only session keys never gain wallet spending authority. Unknown submissions require receipt recovery, not an automatic retry.

Read [collection rules](public/nft-guide.md), [art provenance](docs/nft/ART.md), [deployment instructions](docs/nft/README.md) and [verification evidence](docs/nft/VERIFICATION.md). Mainnet minting/trading stays disabled until contracts are deployed and configured. BNB network gas applies even to free mints. The contracts are tested but have not received an independent security audit.

## Current token status

Token name, symbol, contract, total supply, launch date and points-to-token conversion ratio: **TBA**. These will be decided and announced later. The current release is the points game; token conversion remains closed. See the website’s Docs section.

## Deploy to Vercel

The full Next.js/PostgreSQL target is in [`deploy/vercel`](deploy/vercel/README.md). Use `npm run build:vercel` and configure PostgreSQL plus a signed browser-session secret in Vercel. This target uses wallet-controlled pairing instead of ChatGPT Sites sign-in. The original Cloudflare Sites target is preserved.

## Run and build

Node 22.13+ is required. `npm ci`, `npm run db:generate` only after schema changes, `npm run contracts:build`, `node scripts/bundle-agent.mjs`, `npm test`, `npm run build`. The Sites Vinext/Vite integration packages the Worker, assets and D1 migrations. Hosting configuration retains the existing Site ID and provisions `DB`.

For local D1, build and apply each SQL migration in `drizzle/` once using:
`npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file <migration.sql>`

`npm run dev` supports local sign-in via the starter's Sites integration. Production sign-in and Site audiences are owned by Sites, not this application. Do not expose the Worker behind an alternate path that accepts user-supplied `oai-authenticated-user-id` headers.

## Connect an actual agent

Read [the agent integration guide](public/agent-skill.md). The dashboard generates a ten-minute, single-use pairing capability. The agent must already have the official Binance `baw` CLI connected, a claimed Agent ID, and Developer Mode enabled. The connector previews a typed signature, waits for explicit user approval, then authorizes a game-only session key for one hour. Binance wallet keys never leave Binance's controls. The session key remains on the agent host with restrictive file permissions.

A private Site also requires the platform-issued service credential in `TAPTAP_SITE_ACCESS_TOKEN`. Never embed it in the browser or source. External agents can reach a public Site without it; changing audience is a separate owner choice. Pairing still requires a signed-in Site account, and all agent gameplay still requires signatures and on-chain identity.

Agent identity gate: BSC chain 56, SPACE ID Agent ID registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`. Verified from live bytecode and contract `name()` / `symbol()` (`SPACE ID Agent ID`, `AI`); reference implementation: https://github.com/gangfun/gang-launchpad/blob/main/config/MainnetAddresses.sol. Official Binance flow: https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet. BNB ERC-8004 agent IDs are a separate registry and are not accepted by this gate.

Wallet signatures and NFT ownership prove key control and eligibility; they do not prove an AI model produced a request. The agent connector is a transport and runner that an AI assistant operates, not an LLM pretending to be an agent. No browser or user-agent heuristic is treated as identity proof.

## Integrity rules

PostgreSQL is the production source of truth; the original Sites target uses D1. Economic writes use compare-and-swap versions and unique event guards in a transactional batch. The ledger records every credit/debit. EIP-712 protocol v2 uses the Binance-compatible domain fields `name`, `version`, and `chainId` without `salt`. Sessions and actions bind the Site origin in a signed message field. Fresh pairing and the latest agent connector are required after the v2 upgrade. Nonces are consumed once, timestamps expire after 60 seconds, and identity ownership is rechecked every five minutes. A heartbeat may accrue at most ten seconds of taps; the server limits power, speed, energy and remaining command target. Idle energy recharges at 5/sec; no offline points. Owners can revoke sessions. Upgrade levels cap at 20. Mission rewards are one-time and transactional. Signed token freeze also blocks in-flight economic writes at the database update.

## Token launch and conversion

The game backend can run immediately. Token claims need actual deployment, gas, token funding, and owner-selected economics. No mainnet token address or conversion rate is invented.

1. Choose name/symbol, total supply, owner public wallet, raw token units per point and distribution budget. Copy these into a local `launch.json`; no secrets belong in that file.
2. Compile contracts. `node scripts/deploy.mjs launch.json` prints a reviewable plan without broadcasting. Actual broadcast requires an owner-controlled deployment environment and BNB for gas. A fixed supply is minted to the owner, and the rewards contract is separately deployed. Verify both contracts' source on BscScan.
3. Configure production runtime `ADMIN_WALLET` through Sites to the owner public address. No administrative endpoint works without it. Optional `BSC_RPC_URL` selects a production HTTP RPC; defaults use public BNB endpoints.
4. Freeze the season with a signed `/api/admin/freeze` request, then export `/api/admin/snapshot`. `scripts/operator.mjs` prepares exact EIP-712 requests and submits user-signed requests. Economic writes remain frozen while claims are open.
5. `scripts/build-allocation.mjs snapshot.json distribution-config.json allocation.json` converts integer point balances into integer token base units, builds sorted Merkle proofs, and checks an optional distribution cap. Config fields: `epoch`, `contract`, `token`, `rawTokenUnitsPerPoint`, `maximumDistributionRaw`. For subsequent epochs, provide cumulative lifetime entitlements, including previously claimed allocations; never reset cumulative amounts.
6. Fund the rewards contract. Call `proposeRoot(root)` from the owner wallet, wait the enforced 24-hour delay, and call `activateRoot()`. Signed `/api/admin/publish-rewards` imports up to five allocations per request only after their proofs and active on-chain root, token, registry, owner and epoch match.
7. Eligible agent wallets use `claim-preview` to validate their allocation and preview a direct on-chain claim. Claims are cumulative: only the difference from previous claims transfers, preventing double conversion across epochs. Recipients cannot be redirected. The operator can pause claims and cancel pending roots; ownership transfer uses two steps. The owner cannot withdraw the funded reward token through the rewards contract.

The token contracts are tested, not independently audited. The operator controls distribution roots, so allocation correctness depends on the published snapshot and conversion terms. Do not advertise guaranteed token value or audit status.

## Runtime configuration

- `DB`: managed D1 binding, provisioned by Sites.
- `ADMIN_WALLET`: launch operator's public EOA address, unset until the owner supplies it. Operator signatures authorize freeze and allocation publication only.
- `BSC_RPC_URL`: optional HTTP endpoint on chain 56.
- Agent host only: `TAPTAP_SITE`, `TAPTAP_PAIRING_CODE`, and for private Sites `TAPTAP_SITE_ACCESS_TOKEN`.
- Deployment host only: `DEPLOYER_PRIVATE_KEY`, injected by an operator-controlled secret manager; never provided to the website or requested in chat.

Tests cover signed enrollment, replay rejection, cross-account access, points and mission accounting, command cancellation, session revocation, time/energy limits, signature domain/payload binding, and local-EVM token eligibility, root delays, pause, proof validation and cumulative claims. Chromium browser checks cover mobile/desktop navigation, pairing, signed points, profiles, rounds, challenges and real PNG generation. Binance app approval remains an external dependency.
