# Withdrawal, disqualification and reinstatement — 28 October 2026

Shared-tour organizers and appointed administrators can choose **Hantera resultat** on a recorded round to withdraw, disqualify or reinstate it. Each decision requires a reason and an explicit action. It applies to the entire submitted scorecard, including all players/teams in that submission; it is not a player-wide or single-subject sanction.

Withdrawn and disqualified rounds remain readable, with their original hole scores, totals, course/handicap snapshots and audit history. They contribute nothing to shared standings or shared player profiles, regardless of approval policy or game mode. **Visa scorekort** works for excluded records; contributors and spectators can view scorecards but cannot change status. Local history retains the score and displays its shared-tour status separately. Personal statistics and unrelated local tours retain their own scorecard history.

Reinstatement returns the same server/client round identity to active status. In approval-enabled tours it becomes provisional and requires a fresh organizer approval; in casual tours it counts again immediately. Scores and approval cannot be edited while excluded. A status decision cannot also alter a score, approval or played date. Withdrawal and disqualification can be changed into each other, retaining every decision in the audit.

## Consistency and evidence

The Worker checks organizer/administrator permissions and the expected round revision. Competing decisions cannot overwrite each other. Successful retries are idempotent and do not duplicate audit entries. The status, reason, actor, time, before/after status and result totals commit atomically using the existing append-only round audit. Status-only decisions preserve the submitted subjects exactly and do not falsely mark scores as corrected.

Public `rounds` contains only counted results. Active provisional scorecards remain in `provisionalRounds`; withdrawn/disqualified scorecards appear in `excludedRounds`. The updated app combines these for reading and management. Older app versions omit excluded records from their standings even if they do not understand the new status. WebSocket broadcasts and existing account notifications announce status changes. Newer tour snapshots update matching local history and carry status through account sync and JSON backup validation.

Audit records follow the tour retention/deletion policy. This does not add an indefinite external archive. A device must obtain the updated tour to learn a status decision; offline cached views can remain old until refreshed.

## Validation

Coverage includes casual and approval-enabled tours; unauthorized requests; blank reasons and mixed mutations; simultaneous decisions; stale revisions and retry safety; unchanged scorecards; confirmation blocked while excluded; reinstatement requiring fresh approval; audit retention; broadcasts; eligibility across all five game modes; local history and backup status; safe reason rendering; read-only scorecards; contributor permissions and multi-browser controls. Production smoke uses a synthetic tour, checks withdrawal/disqualification/reinstatement and fresh approval, then deletes the tour.

Release verification passed: 122 root unit tests, 76 Worker tests and 179 browser checks, with one expected WebKit PWA skip. Both dependency audits reported zero vulnerabilities; Worker deployment dry runs passed.
