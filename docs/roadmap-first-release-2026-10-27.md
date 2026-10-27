# First roadmap increment — 27 October 2026

Implementation of the three focused first choices from [the prioritized feature roadmap](feature-roadmap-2026-10-27.md). The later roadmap items remain planned work.

## Implemented

### Play again and saved groups

- History has a Play again action and the start page offers the most recent round plus named saved groups.
- Reuse preserves course/tee snapshots, each player's tee, game mode, team allocation and scramble minimum drives. Scores, marker winners, wagers, played date, tour submission links, editing IDs and live credentials are cleared.
- Reuse opens player review. Stable saved-player IDs refresh names and handicap indexes from today's local player register. Missing individual handicaps in old shared-score history remain empty and must be entered. Unlinked guests retain their saved values for review.
- Saving a group validates the whole setup. Replacing a same-name group requires confirmation; deleting a group records a tombstone. Groups are limited to 100 per account/device vault.
- Saved groups are account scoped, included in three-way account sync and JSON/Drive backups, and have a separate JSON-export selection. New servers preserve the collection when older clients omit it. Backups and snapshots reject unknown setup fields, including device credentials.
- Starting from a group or joining live warns before replacing the currently saved active round. Multiple recoverable drafts are still future work.

### QR and link joining

- Host invitations show an offline-generated QR, private link, system share action, copy-link action and the existing code fallback.
- The URL contains only the invitation code in a fragment; unrelated query parameters and fragments are removed. Host and seat scoring credentials never enter the link or QR.
- A deep link opens a course/host-seat/availability preview. Pasting a link or raw code works. A seat is never automatically claimed.
- The original private-code protections and caller limits remain. QR encoding is local; no third-party QR service receives the invitation. The vendored encoder is checked against the installed pinned dependency.
- Live-room creation serializes only the public API player fields, and two-player scramble can create its single shared seat.

### Explain my points

- Playing-handicap badges in setup and scoring are buttons with an input/formula explanation, including the engine's rounding-before-halving rule for nine holes.
- Hole-point buttons explain gross score, strokes received or given, net score and Stableford points. Unfinished and picked-up holes have distinct explanations. Fourball and match explanations identify how the result is used.
- Team handicap explanations use the existing scramble/foursome rules; they show member inputs when those are available locally.
- Explanations use the existing scoring engine and open in a keyboard-accessible dialog with focus restored on close. History expansion now has a native button separate from edit/share actions.

## Validation

Automated coverage includes setup replay without credential/score copying, current handicap refresh, mixed tees and team reconstruction, backup validation, group deletion/older-client sync preservation, QR decoding, safe deep-link parsing, the actual browser live-create payload against Worker validation, single-team scramble, keyboard explanation/focus behavior, pickup/unfinished distinctions and joining without an automatic seat claim. `npm run verify:release` passed: 109 JavaScript unit tests, 60 Worker tests, 137 browser tests across desktop/mobile Chromium and WebKit, asset/version checks, a Worker deployment dry run, and zero vulnerabilities in both npm audits. The existing WebKit offline-PWA case remains explicitly skipped; five final Chromium feature tests also passed after the small-phone formatting check. Physical camera/system-share behavior and iOS offline navigation still require device checks.

## Next model decisions: draft recovery and score corrections

These are implementation constraints for the next increment, not claims that recovery or approval has shipped.

1. **Separate round lifecycle from approval.** Round lifecycle is `draft → in_progress → submitted/completed`; approval is a separate `provisional/confirmed/withdrawn/disqualified` field. Casual rounds can complete without approval. Existing finished rounds migrate as completed, with their current standing behavior preserved.
2. **Multiple local drafts first.** Persist named drafts transactionally per account, with an immutable ID, revision, setup snapshot, date, practice/competition flag, nullable hole results and local update time. Creating another draft must not overwrite an existing one. Use explicit picked-up state rather than treating every blank as zero.
3. **Account handoff needs revision/ownership checks.** Sync draft data separately from device capabilities. Never include live host/seat tokens in a cloud draft or portable backup. An explicit takeover uses the expected revision and an ownership lease; competing offline edits create a visible fork/conflict. Downloads cannot silently take scoring ownership.
4. **Trash must cooperate with tombstones.** Retain deleted local round payloads for a defined restore window (proposed: 30 days). Restoring needs a revisioned restore event or a new identity with `restoredFrom`; simply removing a deletion tombstone would let stale devices resurrect deleted data. Shared-tour withdrawal is separate from local trash.
5. **Freeze scoring inputs on submission.** Each shared round needs its own member handicaps, tee/course data, team membership and scoring-rule snapshot. Later edits to a player or course cannot alter an old scorecard.
6. **One authoritative correction operation.** A hole correction submits round ID, expected round revision, changed gross/pickup inputs and a required explanation. The Worker verifies permissions, derives net points/team totals, appends before/after records and broadcasts the new revision. A durable audit log must remain append-only through the retention period; the current bounded in-object history cannot be the sole audit record.
7. **Keep identities aligned.** Preserve the client-round-ID/server-round-ID mapping so a correction updates the local history record and leaderboard together, rather than creating a second scorecard. Retry keys remain idempotent. Approval, withdrawal and disqualification use the same revisioned mutation path and retain evidence.
8. **Migrate and test the model before optional stats.** Keep old backups readable. Treat historical skipped rows conservatively; they cannot prove whether a hole was never started. Test two-device handoff, offline forks, quota/transaction failures, trash restoration, concurrent corrections, all five game modes and provisional leaderboard rules before extending per-hole statistics.

Before deployment, deploy the Worker snapshot support for saved groups alongside the browser shell; an older Worker rejects the new snapshot keys. The source changes in this increment are local until explicitly committed/pushed.
