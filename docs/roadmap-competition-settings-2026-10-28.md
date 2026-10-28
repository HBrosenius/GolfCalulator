# Competition settings, ties and counted-round explanations — 28 October 2026

Shared-tour organizers and appointed administrators can choose **Tävlingsformat** and **Särskiljning vid lika total** under **Redigera villkor**, before play starts. Existing tours default to their previous Stableford totals and handicap-based ordering. Local tours retain that default as well; the new settings UI is for shared tours.

## Formats and eligibility

- **Poängbogey:** highest counted Stableford total wins; the existing five scorecard game modes remain supported.
- **Individuellt bruttoslagspel:** lowest counted gross-stroke total wins.
- **Individuellt nettoslagspel:** lowest counted sum of gross strokes minus the originally allocated handicap strokes wins. Plus handicaps therefore give strokes as before.

Stroke-play tours require individual play, recorded strokes on every hole, equal-length courses and a fixed **Antal bästa rundor** within the available course quotas. Pickups and team formats cannot be submitted as stroke-play results. An incomplete scorecard remains a draft instead of becoming a stuck queued submission. A player who has not yet reached the required number of counted rounds has an **Ofullständig serie** and no placement or medal, even if that partial stroke total is numerically lower.

These formats sum raw gross/net strokes, not strokes relative to par. Organizers choose the allowed courses/tees and course quotas accordingly; this release does not normalize performance across different courses or implement official competition/handicap-service submission rules.

## Counting and tie-breaks

Existing per-course maximums and first/best duplicate-course rules apply before the overall best-of limit. For Stableford, best means highest points; in stroke play, best means lowest strokes. **Vilka rundor räknas?** expands each standings row to show counted and discarded rounds, their values, course-limit exclusions and best-of exclusions.

Tie choices are:

- **Lägre HCP, sedan tourens spelarordning:** preserves the existing ordering, including the previous roster-order fallback when points and handicaps are equal.
- **Delad placering:** identical totals share a place, using competition numbering such as 1, 1, 3.
- **Bästa räknade runda, sedan nästa:** compare each player's counted values in best-to-worst order. If those all match, share the place. This is an app-defined round comparison, not a last-nine-hole countback rule.

Members and spectators use the same placements and units. Profiles, best-round summaries and head-to-head comparisons use the selected score metric; personal scorecards still retain both their original Stableford points and gross hole results.

## Rule integrity

The first server-recorded round start or submission locks format, tie-break, best-of, duplicate-course rule and course limits. Names and valid dates remain editable. Each submitted result retains a competition-rules snapshot alongside its frozen course/member data. Approvals, withdrawals and corrections retain their existing audit and eligibility behavior; stroke-play corrections cannot turn a hole into a pickup.

A rules revision travels with new scorecards and submissions, including local recovery/backup metadata. A stale revision is rejected instead of silently reinterpreting a scorecard after settings changed. Offline play cannot lock a server that it has not contacted; a scorecard started against subsequently changed rules must be reviewed/restarted with current rules, with the local evidence preserved. Older clients may continue normal legacy tours, but custom competition results are separated into `competitionRounds`, preventing those clients from ranking them as Stableford.

## Verification

Coverage includes gross/net direction, frozen handicap strokes, incomplete series, shared and best-round ties, legacy ordering, course/best-of exclusions, unsupported scorecards, settings locking, stale revisions, pickup correction rejection, legacy-safe responses, rules-revision portability, format-aware spectator views and the complete browser setup/scoring flow. Production smoke exercises net stroke play with approval, correction, exclusion, reinstatement, event scheduling and audit checks on a synthetic tour that is deleted afterward.

Release verification passed: 136 root unit tests, 81 Worker tests and 200 browser checks, with one expected WebKit PWA skip. Both dependency audits were clear and Worker deployment dry runs passed.
