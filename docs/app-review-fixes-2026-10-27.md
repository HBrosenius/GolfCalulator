# Review fixes — 27 October 2026

Implementation follow-up to [the original review](app-review-2026-10-27.md). Changes are local; nothing has been deployed.

| Finding | Implemented behavior |
| --- | --- |
| 1. Stale-device overwrites | A per-account last-synced baseline drives a three-way merge. Unchanged devices accept cloud edits; competing changes require an explicit cloud/local choice. Edits made while a sync request is in flight are retained and queued. |
| 2. Account isolation | Collections, active rounds, shared-tour credentials, baselines and sync metadata use separate account/API vaults. Legacy device data remains in the guest vault and has an explicit import action. Account changes invalidate pending sync results, reset transient round state and reload other tabs. Logout strips cached account-bound tour tokens; migration also strips legacy guest-cache account tokens. |
| 3. Live-room access | New invitations use 20 random characters instead of four. Short codes no longer address live rooms. Lookup/claim limits are per caller; ordinary polling has a separate allowance. Pre-join previews omit handicaps, scores, notes and bets. Full reads require a host/seat credential. Hosts can revoke a seat credential and reopen the seat for recovery. Public shared-tour spectator access remains separate. |
| 4–5. Scoring authority and fourball | The Worker derives par, stroke indexes, playing handicaps, allocated strokes, net scores, points and totals from stored tour members/tees using the shared scoring engine. It rejects inconsistent derived client fields and persists recalculated subjects. Team modes require distinct two-person teams; shared-score rows/tees must agree. Fourball keeps individual rows and derives each team's best score on every hole. |
| 6. Deletions | Courses have stable IDs, including deterministic migration IDs. Player/course tombstones flow through storage, backup validation/import/export, snapshot merging and server preservation, preventing stale-device restoration. Renames preserve course IDs; newly recreated courses receive a new ID. |
| 7. Write failures | Snapshot batches verify writes and roll back earlier collection writes on failure. Failure leaves sync in an error state, retains the download in memory for recovery, and does not advance the baseline. |
| 8. Plus handicaps | Handicap indexes use a signed −10 through 54 range in setup, saved players, profiles, backups, live-room creation and shared-tour membership. Labels explain entering a plus handicap with a minus sign. |
| 9. Dependencies | DOMPurify 3.4.17 is installed and vendored, with a byte-for-byte vendor check in the verification gate. Worker tooling and vulnerable transitive libraries are patched. Shared-tour administration binds allowlisted event listeners after sanitization and no longer permits inline event attributes. Updated shell URLs invalidate old cached modules. |

The scoring UI also has explicit player/hole input names, setup label associations, table headers, focus movement between steps, unrestricted zoom, immediate saved-course browsing, an explanation beside Next, explicit picked-up holes, confirmation before finishing with missing scores, and a large single-hole view with previous/next controls.

## Verification

- 101 JavaScript unit tests.
- 57 Worker tests, including all five game modes round-tripping actual client serialization through HTTP endpoints, forged-score rejection, room credential revocation/previews and tombstone preservation.
- 122 browser tests passed, with one explicitly skipped WebKit offline-PWA case. Matrix: desktop Chromium, mobile Chromium and iPhone-sized WebKit. Coverage includes stale-device edits/conflicts, account switches during requests, quota failures, keyboard score navigation, accessibility names, guest import, pickup/completion choices and browser-to-Worker plus-handicap submission.
- `npm run verify:release` passed: version and vendored-asset checks, unit/Worker/browser suites, Worker production deployment dry run, and root and Worker npm security audits.

The WebKit PWA offline-navigation test is explicitly skipped: Playwright's WebKit runtime returns an internal error when reloading a service-worker-controlled page after `context.setOffline(true)`. The equivalent desktop/mobile Chromium lifecycle tests run. Physical iOS/Safari offline behavior, bright sunlight, text scaling and real-device ergonomics still need device testing.

## Rollout and migration

Deploy the Worker and browser shell together: old four-character live rooms must be restarted with a new private invitation. Saved historical round references still import. Guest data is retained on the device; signing in shows the account vault and requires explicit import to copy guest records into it. For an existing installation without a baseline, differing records produce a conflict rather than silently selecting a winner.

The existing Cloudflare test adapter keeps its supported Miniflare version; explicit overrides patch Zod, Undici and Sharp without replacing that runtime API. The lockfile includes both the adapter’s original runtime and the newer Wrangler runtime, and the Cloudflare types satisfy the newer Wrangler peer requirement. CI installs Chromium and WebKit for the full configured browser matrix. Both audit trees report zero vulnerabilities at verification time. A clean dependency install and the Worker tests were exercised after regenerating the lockfile.
