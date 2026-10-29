# Real tester checklist — production candidate

Run against [CANDIDATE_URL] at [UTC_TIME], build [BUILD_ID]. Tester: [CONSENTED_ALIAS]. This checklist supplies evidence; unchecked items are unverified. Use the deployment’s actual authentication flow: the repository contains both a Sites target and a Vercel wallet-pairing target.

## Setup and eligibility

- [ ] Official URL and support route resolve on mobile and desktop; no broken launch links or stale demo labels.
- [ ] A real tester has the official Binance `baw` CLI connected, a claimed eligible SPACE ID `.ai` Agent ID on BNB Chain (chain 56), and Developer Mode enabled.
- [ ] Record public eligibility proof with consent. Confirm a separate ERC-8004 identity alone does not pass this gate.
- [ ] Complete the actual deployment’s sign-in/owner pairing. Review the typed signature and intended Site origin before approval. Do not share private material with the operator.
- [ ] The agent starts through the documented connector, stores a game-only session key on the agent host, and reaches a paired/ready state. Record setup duration and exact failure step if blocked.

## One genuine coaching loop

- [ ] Capture initial points, energy and upgrades; submit one supported prompt from the dashboard.
- [ ] Verify the queue receives it. Confirm queued does not appear as executed until the agent acts.
- [ ] The real agent fetches the command and submits accepted signed actions. Save redacted acceptance evidence and corresponding UI result.
- [ ] Compare observed points, energy and status against accepted actions. Note run duration and prompt; do not attribute unrelated existing points to this run.
- [ ] Submit a changed plan and verify the next command is followed; cancel a queued/running command through the supported control and verify the resulting status.
- [ ] Browser interaction without an agent does not earn tap points. A disconnected or stopped agent does not accrue offline points.

## Control and persistence

- [ ] The owner revokes the game session; further agent writes from it fail. Pair a new session only with fresh approval.
- [ ] Sign out/reload/reconnect and confirm lifetime points persist for the same eligible wallet. Check that any season/day/event view does not overwrite lifetime accounting.
- [ ] Verify an expired pairing capability or expired session fails in the expected way; capture the visible recovery guidance.
- [ ] Confirm token conversion is closed and all token terms display TBA. No placeholder contract, promised rate, guaranteed airdrop or returns appear.
- [ ] Inspect mobile layout at a narrow viewport: coaching form, real status, errors, docs and support remain readable and usable.

## Independent-wallet competition checks

- [ ] Challenges/rematches: two consenting real agents can enter, complete and view a real result. Verify settlement rules, cancellation and rematch behavior before marketing availability.
- [ ] Prompt Wars: publish rules first; verify equal starting resources and isolated event scoring for every entrant; verify lifetime points are retained. Otherwise label the idea proposed and skip the event claim.
- [ ] Spectator profiles: confirm public/private boundaries, consent and no ability to issue another owner’s commands.
- [ ] Share cards: verify every displayed value comes from the represented real run/profile; check intended public identifiers and preview appearance. Otherwise use a truthful manual recap explicitly marked as such.
- [ ] Cohort: verify admission method and the up-to-100 agent-wallet cap; if manually managed, reconcile the actual list before claiming seats remain.

## Feedback report template

URL/build; UTC time; connector version; device/browser; redacted tester alias; step attempted; expected result; actual result; reproducible steps; redacted screenshot/action evidence; severity; issue owner; retest result. Never include private keys, seed phrases, session secrets, private access tokens or live pairing capabilities.

## Release record

Record passed/failed/blocked for each section, evidence links, unresolved launch blockers and a named reviewer. At least one real eligible-wallet queue → accepted signed action → persistent points run must pass before public gameplay/demo claims. This checklist does not replace the repository’s automated checks or an independent contract audit. No token launch is authorized by Season 0 copy.
