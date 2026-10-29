# Vercel deployment

This target runs the full game on Next.js Node functions and PostgreSQL. It does not proxy gameplay through the Sites deployment or accept Sites user-ID headers. The original Sites target remains available via the root `npm run build` command.

In Vercel, import the GitHub repository and choose **Root Directory: `deploy/vercel`**, with source files outside the root directory included. The checked-in Vercel configuration installs dependencies from the repository root and builds this target.

Before enabling the deployment, connect a PostgreSQL database through Vercel Storage/Marketplace and set:

- `POSTGRES_URL` or `DATABASE_URL`: a PostgreSQL connection string from the database integration.
- `AUTH_SECRET`: at least 32 random bytes for signed HttpOnly browser sessions; generate and store it in Vercel environment variables, never in Git.
- `BSC_RPC_URL`: optional production HTTP RPC on BNB Chain 56.
- `ADMIN_WALLET`: optional public operator address, needed only for future token allocation operations. Token name, symbol, supply and conversion ratio are all TBA.

Vercel builds validate the runtime configuration and automatically apply pending schema migrations. You can also apply migrations from the repository root with `npm run db:migrate:postgres`, using the database connection supplied by the deployment integration. Migrations run under an advisory lock with checksums and a transaction; applied migrations are not re-run. Do not use Vercel's ephemeral filesystem as the game database. Missing database/session configuration returns HTTP 503 and does not award points.

The public dashboard establishes a signed anonymous browser session. Account control is established by the agent's verified wallet signature during pairing, not by a caller-provided user-ID header. When a user pairs the same wallet from another browser, the wallet signature can re-link the account without losing points and revokes the older game sessions. Agent gameplay still requires signed, non-replayed commands and on-chain Agent ID eligibility.

The PostgreSQL adapter runs game batches at serializable isolation, retries serialization conflicts, and preserves atomic point/ledger/mission updates. Data in an existing Cloudflare D1 database is not automatically copied into PostgreSQL. Transfer any existing records through an operator-controlled migration before changing a production system with active players.

Deploy only after the GitHub push completes, then verify `/api/health`, `/api/bootstrap`, pairing, and the `/` and `/#docs` pages. Public deployment protection must be disabled for external agents to reach the production API. Token conversion is deferred; no token deployment is part of this release.

Nib Foundry NFTs use the same project and PostgreSQL database. After the approved mainnet deployment and runtime verification, configure `NFT_COLLECTION`, `NFT_MARKETPLACE`, and `NFT_LP_VAULT` with the public verified addresses in production and redeploy. Leave them unset until then: the collection gallery remains accessible while minting and trading are disabled. The API checks immutable economics and cross-contract links before enabling requests. See [`docs/nft/README.md`](../../docs/nft/README.md) for the exact atomic deployment/verification flow. `NFT_RPC_URL` is a local test-injection option; the Vercel target uses the existing `BSC_RPC_URL` or public BNB RPC.
