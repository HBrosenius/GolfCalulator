# Optional shared-tour approval — 28 October 2026

Organizers and appointed administrators can opt a shared tour into review under **Redigera villkor → Kräv organisatörens godkännande av rundor**, before its first submitted round. The policy is fixed after the first submission, including against older clients omitting the field. Existing and casual tours default to immediate acceptance.

In a review tour, every submitted round starts provisional, including organizer submissions. Its hole results remain visible, but it contributes nothing to shared standings, player profiles, best-round summaries or head-to-head statistics until confirmed. Spectators use the same eligibility rule and see provisional labels. Local history retains approval status separately from round completion and upload status.

**Granska och godkänn** opens the submitted hole scores, handicap strokes and points. An organizer or administrator records a comment and confirms the reviewed round revision. **Återöppna granskning** requires a reason and removes that round from the standings until it is approved again. Any hole or played-date correction automatically resets a confirmed round to provisional. Editing and approval are separate operations; one request cannot change a score and approve it simultaneously.

Decisions use the existing authoritative correction operation, round revisions, idempotency keys, atomic writes and append-only audit storage. Concurrent corrections invalidate stale approval attempts. Repeating a successful request returns its prior evidence without duplicating a decision. The audit shows before/after approval status, actor, time and reason. Approval alone does not falsely mark hole scores as corrected. Realtime broadcasts and account notifications update affected viewers using the existing tour channels.

This increment provides organizer/administrator review. Independent marker approval, withdrawal/disqualification and approval-policy changes for tours that already contain rounds remain future work. Audit retention follows the tour lifetime, as documented in the [correction increment](roadmap-score-corrections-2026-10-28.md).

Validation includes default/legacy behavior, authorization, policy locking, submission status, confirmation/reopening, correction invalidation, stale decisions, retry and audit behavior, confirmed-only standings/profiles, organizer forms, local history and spectator eligibility.

For older clients, public `rounds` contains only counted/confirmed results in a review tour. Provisional scorecards are delivered separately as `provisionalRounds`; the updated app combines them for review without counting them. This prevents an older standings implementation from accidentally including provisional scores.

Release checks passed: 119 root unit tests, 74 Worker tests and 170 browser checks, with one expected WebKit PWA skip. Both dependency audits were clear and Worker deployment dry runs passed.

The Worker deployment workflow now watches its shared validator, account-sync and scoring imports. The approval-aware snapshot validator is deployed before the browser begins syncing approval metadata. Production smoke also exercises provisional submission, approval, audit evidence and retry safety on a synthetic tour that is deleted afterward.
