# App review — 27 October 2026

Reviewed the local checkout, account and live-round API boundaries, scoring/submission code, persistence, and core browser flows. No application code was changed. Priorities below reflect user impact, not advisory database severity.

## Verification

- `npm run verify` passed: 98 JavaScript unit tests, 49 Worker tests, 36 Chromium browser tests, version check, and Worker deployment dry run.
- Independently exercised merge logic and the actual fourball scoring/submission functions against the Worker validator; results are recorded below.
- Manually inspected course selection, player setup, and score entry in the browser, including the accessibility tree.
- Queried npm advisories for both dependency trees. Root: 1 affected package, reported critical by npm. Worker: 10 affected packages (8 high, 2 moderate), including transitive development tools. These are package counts, not ten independently exploitable production vulnerabilities.
- No production attack testing, account changes, or deployment. Safari/iOS and real multi-device sessions were not exercised. Existing passing tests do not cover all the cases below.

## 1. P1 — stale devices silently overwrite newer cloud edits

Evidence: `src/account-sync.js:47–51`, `index.html:4342–4355`.

`mergeCollection` always inserts local records after remote records, so local wins for every matching ID. Normal synchronization fetches the latest cloud version and uploads this merged snapshot against that version. Consequently, version-based conflict detection does not catch a stale device overwriting an edit already present when the fetch started.

Reproduced: cloud player `{id:1,name:'Updated',hi:8}` plus stale local `{id:1,name:'Old',hi:20}` produces the old name and handicap. Periodic sync can perform this without a deliberate user edit.

Fix: retain a per-account last-synced baseline and perform a three-way merge, or track per-record revisions and local dirty state. Preserve remote-only changes and require a choice for competing changes. Add a two-device test where device B remains unchanged while A edits a player or round.

## 2. P1 — signing into another account uploads the previous account's local data

Evidence: `index.html:4281–4300`, `index.html:4307–4311`, `index.html:4444–4451`.

Logout deliberately retains the device's data. The next login automatically schedules a merge/upload of those same global collections, without checking which account previously owned them or asking to import guest data. On a shared browser, account B can receive account A's player records, photos, rounds, and local tours.

This is a confirmed code path; no real accounts were used to reproduce a cross-account transfer.

Fix: scope local data and synchronization metadata by account ID, keep guest data separate, and make importing guest/device data an explicit choice. Cancel or invalidate in-flight synchronization when the account changes. Review cached shared-tour credentials during logout too: `syncAccountTours` stores session tokens in shared-tour records, while logout only removes the main session record.

## 3. P1 — live-room codes permit discovery and unapproved seat claims

Evidence: `sync-worker/src/index.js:17`, `sync-worker/src/index.js:276–290`, `sync-worker/src/room.js:15–38`, `sync-worker/src/room.js:97–118`.

Live rooms use four characters from a 31-character alphabet: 923,521 possibilities. GET by room code needs no credential and has no application-level lookup rate limit. Responses disclose player/course information, scores, notes, and seat availability. A caller with the code can claim any unclaimed seat and receive its scoring credential; no host approval is required.

The failed-claim limit is shared across the room. Ten failed claims in a minute can also block legitimate joiners. Creation throttling does not protect discovery.

Fix: rate-limit lookups and claims by caller, use a high-entropy join capability or host-approved lobby, limit pre-join information, and provide seat recovery/revocation. Preserve a deliberately public spectator mode separately. Production edge/WAF controls were not inspected, and no room enumeration was performed.

## 4. P1 — shared-tour validation trusts client-supplied scoring inputs

Evidence: `sync-worker/src/tour-validation.js:104–142`, `sync-worker/src/tour.js:470–500`.

The validator checks arithmetic consistency, but does not compare row par or stroke index with the selected stored tee, or derive allocated handicap strokes from the tour member and game mode. An authorized contributor can submit internally consistent but inflated points.

Reproduced locally: for a stored par-4 course and handicap-zero member, rows claiming par 6 and four received strokes, with gross score 4, net 0, and 8 points per hole passed validation. The nine-hole submission was accepted by the validator with 72 points.

Fix: derive course fields and handicap allocation server-side, then calculate points and totals there. For team modes, validate team membership and use the appropriate team scoring rule. Manual gross scores still require trust, but course and scoring rules should not be client-controlled.

## 5. P2 — valid fourball rounds fail shared-tour synchronization

Evidence: `index.html:3491–3517`, `src/tour-rules.js:145–193`, `sync-worker/src/tour-validation.js:137`.

Fourball correctly assigns each teammate the team's best-ball total while retaining each player's individual hole rows. Submission preserves both, but the Worker requires every player's individual row sum to equal the team total.

Reproduced using the actual scoring and serialization functions: two teammates score 18 and 9 individual points, both receive the team total of 18, and submission fails with `Round points do not match hole results`. Retrying cannot repair this payload.

Fix: validate individual rows independently and derive the fourball total from the best score on each team hole. Add a round-trip integration test with teammates contributing different hole results.

## 6. P2 — deleted players and courses return on the next sync

Evidence: `src/account-sync.js:66–84`, `index.html:1596–1598`, `index.html:7459–7462`.

Rounds and tours have deletion tombstones; players and courses do not. Deleting either only removes it from the local array. Merge then restores the remote entry. Renaming a course/tee also changes its merge key and can leave the old entry alongside the renamed one.

Reproduced: remote containing one player and one course, merged with local empty collections, returns both entries.

Fix: add stable course IDs and deletion tombstones for players/courses across local storage, import/export, sync validation, and server preservation. Test deletion followed by syncing a stale second device.

## 7. P2 — synchronization can report success despite local write failures

Evidence: `index.html:4314–4323`, `index.html:4362–4367`, `src/storage.js:30–37`.

`saveAccountSnapshot` performs separate writes and ignores their success/failure results. Storage helpers catch quota errors rather than throwing. Sync can therefore mark the device as synchronized even when only some collections were saved. Some callers show an alert, but the final sync status is still misleading.

Fix: propagate failures, retain recoverable data, and set success only after all writes succeed. Prefer an IndexedDB transaction for the snapshot. Add a quota-failure test partway through applying a download.

## 8. P2 — plus-handicap support is blocked by the UI and API contracts

Evidence: `index.html:2599–2603`, `index.html:7395`, `sync-worker/src/tour-validation.js:48–50`; contrast `src/scoring.js:44–48`.

The engine explicitly implements negative playing handicaps, and tests exercise plus-handicap scoring, but player setup and saved-player creation reject negative handicap indexes. Shared-tour member validation also permits only 0–54. A plus-handicap golfer cannot use the supported scoring path through normal setup.

Fix: establish one internal signed representation, explain the displayed plus-handicap notation, and apply consistent ranges across forms, profile/member validation, backups, and live rounds. Add a browser-to-Worker test for a plus-handicap player.

## 9. P2 — security dependencies and the browser's vendored copy have drifted

Evidence: `package.json`, `package-lock.json`, `sync-worker/package-lock.json`, `index.html:14`, `src/vendor/dompurify.min.js:1`.

The package pins DOMPurify 3.4.16, but the browser actually loads a checked-in 3.4.13 file. Updating npm alone would leave the served sanitizer unchanged. npm audit reports advisories for the pinned version and several Worker development dependencies; the release audit gate would currently fail.

Important qualification: npm labels the DOMPurify template advisory critical, while the [maintainer advisory](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7) labels it low and describes non-default template/DOM-returning configuration. The inspected application sanitizer call does not enable that configuration. No exploitable XSS path was demonstrated here.

Fix: update compatible patched dependencies, regenerate the vendored browser asset, and add a check that served and installed sanitizer versions match. The advisory lists 3.4.17 as patched. Review dependency changes instead of applying a forced audit fix, which suggests disruptive toolchain changes. Separately replace inline handlers with event listeners so sanitization need not allow `onclick` and `onchange` (`index.html:6735–6738`).

## User-experience improvements

- **Accessible scoring and setup:** score inputs lack accessible names, and player labels lack `for` associations (`index.html:2450–2458`, `index.html:2798–2801`). The browser accessibility tree exposed IDs such as `score_0_0` instead of player/hole labels. Add explicit labels, meaningful score names, row/column header associations, and focus management after step changes.
- **Allow zoom:** remove `maximum-scale=1.0` (`index.html:5`) and verify larger text and zoom on supported mobile browsers. Some browsers ignore the restriction, so behavior needs device testing.
- **Make saved courses discoverable:** the initial course list stays empty until typing, despite seeded courses (`index.html:1795–1799`, `index.html:1722–1732`). I reproduced the empty initial list and saw Kalmar courses only after searching. Show recent/favorite courses plus a browse option; disable or explain Next until a selection exists.
- **Distinguish unfinished holes from picked-up holes:** calculation turns all empty holes into skipped, zero-point rows and saves after any one score (`index.html:3438–3484`). Add an explicit picked-up state and a completion summary before finalizing an incomplete round.
- **Improve field use:** offer a large single-hole entry mode with previous/next hole controls, keeping the full scorecard as an overview. Validate on small phones, bright conditions, and with four players.
- **Broaden regression coverage:** add WebKit/mobile runs, keyboard/accessibility checks, stale-device/account-switch tests, quota failures, and a shared-tour end-to-end test for each game mode. The current Playwright configuration runs Chromium only.

## Suggested sequence

1. Protect account isolation, prevent silent sync overwrites, and close live-room discovery/claim gaps.
2. Fix server scoring authority and fourball submission together; add targeted round-trip tests.
3. Repair deletion propagation and local-write error reporting.
4. Update dependencies and synchronize vendored assets; verify the release audit gate.
5. Ship accessible labels, zoom, course discovery, and incomplete-round handling, then test on real phones.
