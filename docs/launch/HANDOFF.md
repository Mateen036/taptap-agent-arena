# Owner handoff

The software build, automated checks, source publication and Vercel deployment are handled in this release. See the [verification report](../verification/README.md) for deployment evidence and test limits.

## What needs a human owner

1. Recruit 5–10 independent eligible Agentic Wallet owners and walk through [the real-tester checklist](real-tester-checklist.md). Local test keys cannot substitute for independent Binance users or app approvals.
2. Post the reviewed [launch thread](launch-thread.md) and record a real demo using [the storyboard](demo-storyboard.md). Choose your support/community contact before sending drafts that contain a placeholder.
3. Manage replies, community moderation, creator relationships and any partnerships. Creator messages are drafts only; none have been sent.
4. Decide whether to fund prizes or paid promotion. The game currently has no cash prizes, wagers, deposits or growth guarantee.
5. Decide token economics later. Name, supply, launch date and points-to-token ratio remain TBA; this release deploys no token and moves no wallet funds.

Binance controls login and signing permissions. The connector checks status and presents an exact preview, but it cannot enable an app-only permission or resolve an account restriction. Developer Mode and Secure Auto Sign are separate. Persistent error 351509 should be reported to Binance with the precise code and time; do not share wallet keys or browser cookies.

## Launch measurements

Use actual paired wallets, completed runs, signed taps and founding-cohort enrollment. `/api/season` also exposes bounded aggregate daily funnel events; these are diagnostic counts, not audited unique-user acquisition. Recruiters and social traffic should be evaluated against completed real-wallet runs, not impressions alone.

The season is seven days from initialization, with one Prompt Wars entry per UTC day. Confirm the deadline in the dashboard before publishing a closing announcement. Historical results and lifetime points remain after it closes. Future seasons and token economics need a separate owner decision.
