# Shared-tour score corrections — 28 October 2026

Organizers and appointed administrators can correct a submitted hole score or pickup, or change the played date, with a required explanation. Contributors can read the correction history. Casual submission behavior remains unchanged; [approval/provisional results](roadmap-score-approval-2026-10-28.md) are covered by the follow-up increment; [withdrawal/disqualification and reinstatement](roadmap-result-status-2026-10-28.md) are now implemented in a subsequent follow-up.

## Authority and scoring

The Worker accepts raw hole input, derives net score, Stableford points and totals, and broadcasts the resulting tour revision. Shared scramble/foursome team rows change together; fourball totals use the best score on each hole. Match and individual rounds preserve their existing scoring behavior.

Submitted rounds now retain a course/member snapshot and a round revision. Corrections use the original row's par, stroke index and allocated handicap strokes, including for older rounds, so later course or member changes cannot alter historical scoring. An expected round revision rejects concurrent edits with HTTP 409. The earlier date-only API remains compatible and checks the tour revision.

A correction retry carries a mutation ID. Repeating an identical successful request returns its original audit evidence and the current tour; changing a request under the same ID is rejected. The form keeps its inputs on failure and reuses the same ID for transport retries.

## Audit and updates

Each correction stores actor, time, explanation, round revision, before/after played date, changed hole rows and before/after subject totals. Entries are separate append-only Durable Object keys, committed atomically with the corrected tour and retry record. The 100-event activity feed does not truncate this evidence. Authenticated members can page through the audit, 50 entries at a time. Retained legacy date-correction entries are also shown; entries discarded before this release cannot be reconstructed.

Audit records follow the existing tour retention policy (365 days after completion) and are removed when the tour itself is permanently deleted. They are not an indefinite external archive.

Matching local history updates by server/client round identity and member identity, retaining notes, bets and local player metadata. Account sync receives the corrected local result. Older cached tour snapshots cannot replace newer ones. Account switches discard in-flight correction/refresh results; pending submission storage is pinned to the originating vault. Local editing of a shared-tour result opens the shared tour, where an authorized organizer makes the correction.

## Deliberate scope

The organizer form corrects one selected hole (including a shared team hole) per operation, optionally with a date change. The server supports multiple hole changes in one atomic operation. Local trash remains separate from shared-tour results. A device must obtain the updated tour to learn a correction; offline cached results can remain old until refreshed.

Validation covers all five game modes, pickup/re-entry, frozen strokes, authorization, invalid input, concurrent edits, idempotent retries, realtime broadcasts, audit pagination beyond 100 changes, local identity matching, cache ordering, account-switch isolation, safe text rendering and browser form behavior.

Release verification: 116 root unit tests, 71 Worker tests and 164 browser checks passed, with one expected WebKit PWA skip. Both dependency audits reported zero vulnerabilities; Worker deployment dry runs passed.
