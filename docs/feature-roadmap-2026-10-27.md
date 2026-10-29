# Feature opportunities — 27 October 2026

This is a product roadmap proposal based on the current checkout, including the review-fix follow-up. It is separate from the earlier bug report. Priorities are product judgments to validate with users; effort is relative engineering scope, not a delivery estimate.

The app already supports offline scoring, five game modes, multiple tees, accounts, live rounds, shared tours, spectator views, notifications, player history, trend charts, backups and sharing. The latest changes also include single-hole scoring, pickup handling and accessible inputs. Those should not be treated as missing features.

Recommended direction: make Poängbogey a dependable companion for recurring golf groups and small tours, with fast setup, recoverable scorecards and understandable results.

Implementation update: [local round recovery and historical dates](roadmap-round-recovery-2026-10-27.md) now add multiple named drafts, conflict copies, 30-day trash, played dates and practice classification. Account-synced draft handoff remains future work. The first increment adds Play again/saved groups, QR/link joining and Explain my points. See [implementation and next model decisions](roadmap-first-release-2026-10-27.md) for behavior, verification and remaining scope.

## First release: finish the everyday round workflow

| Feature | Smallest useful version | Why it matters | Effort |
| --- | --- | --- | --- |
| Play again and saved groups | Start from a previous round's course, tee choices, players and format; clear scores and confirm current handicaps. Save named groups such as Thursday golf. | Removes repeated setup for regular players. Saved players and recent courses already exist, but do not constitute a reusable whole-round setup. | Small–medium |
| QR and link joining | Add a QR code, system share action and deep link to the existing private live invitation; retain paste as a fallback. Join preview clearly identifies course, host and available seats. | The stronger 20-character invitation should be easy to share without typing. | Small–medium |
| Round lifecycle and recovery | Explicit draft, in-progress, submitted and completed states; multiple named drafts; restore recently deleted rounds. Start with local recovery, then account-synced draft handoff. | A paused round should remain recoverable when starting another round, replacing a phone, or correcting an accidental deletion. | Medium–large |
| Historical round entry | Choose the played date before entering scores; distinguish practice from competitive rounds; optionally support gross-total-only records with clear limits on derived stats. | Makes the app useful for paper scorecards and players migrating an existing history. | Small–medium |
| Explain my points | Tap a hole's points to see gross score, strokes received/given, net score and points; tap playing handicap to see its inputs. | Builds confidence and helps beginners understand the existing calculations. | Small |

Current evidence: `index.html:4424` lists account-synced collections without the active draft; `index.html:4980` stores one in-progress snapshot; `index.html:5494` assigns today's date to new completed rounds. Live sharing at `index.html:4822` displays/copies a code. Draft handoff must use ownership/revision checks and avoid copying device-specific scoring credentials blindly.

Suggested acceptance measures: returning users can start their usual game without re-entering players; joining does not require typing the invitation; a recoverable draft survives a second round; a past round appears under its actual date; points can be explained directly from the scorecard.

## Second release: complete the tour organizer workflow

### Score submission, approval and correction

Implementation update (28 October): [organizer score corrections](roadmap-score-corrections-2026-10-28.md) now cover hole/pickup and date changes, server recalculation, revision checks, retained audit evidence and local-history reconciliation. [Optional organizer approval and provisional status](roadmap-score-approval-2026-10-28.md) are now implemented. [Withdrawal, disqualification and reinstatement](roadmap-result-status-2026-10-28.md) are now implemented. Independent marker approval remains planned.

Add a review screen and optional marker/organizer approval. Show provisional versus confirmed results. Allow an organizer to correct a specific hole with an explanation, recalculate the leaderboard, notify affected players and retain an immutable before/after record. Support withdrawal/disqualification without deleting the evidence.

This extends existing functionality: local scorecards are editable, and shared-tour corrections now use the authoritative Worker operation described above. Approval should remain optional for casual rounds.

Effort: medium–large. Success: a submitted score typo can be corrected once, with all viewers receiving the same result and a clear explanation.

### Event dates, groups and tee times

Implementation update (28 October): [shared-tour events and manual start lists](roadmap-tour-events-2026-10-28.md) now cover dated course events, groups, tee times, personal starts, calendar-file export and group scorecard setup. Availability, randomized pairings and starting-hole/shotgun planning remain later work.

Add scheduled tour legs, participant availability, tee times, group assignment and a personal “where and when do I start?” view. Begin with manual groups and calendar-file export. Later add randomized/balanced pairings, starting holes and shotgun starts.

Effort: medium–large. Success: an organizer can run a small golf weekend without maintaining a separate start-list spreadsheet.

### Competition settings

Implementation update (28 October): [shared-tour formats and tie-breaks](roadmap-competition-settings-2026-10-28.md) now cover Stableford, individual gross/net stroke play, three tie policies, frozen counting rules and counted-round explanations. Divisions, dedicated team leaderboards, match-play tournament structures and season placement points remain later work.

Expose presets for Stableford, gross/net stroke play and match play where appropriate. Add configurable tie-breaks, divisions, team leaderboards and season placement points. Freeze the applicable rules and handicap snapshot per event; explain how each counted round contributes to a standing.

Existing gross totals and team formats are a foundation, not a complete configurable competition system. Avoid making every possible rule a required setup field.

Effort: large. Start with the actual rules used by the app's current groups.

## Third release: help players understand their performance

### Optional per-hole statistics

Implementation update (29 October): [optional individual hole statistics](roadmap-hole-statistics-2026-10-29.md) now add opt-in putts, fairway results/direction, GIR and penalty strokes, with recorded-sample summaries in results and course insights. Drafts, backups, account/live sync and tour submissions preserve optional fields.

Add an opt-in expandable section for putts, fairway hit/miss, green in regulation and penalty strokes. Keep score-only entry as the default. Store “not recorded” separately from zero or a miss, and retain these fields in backups and synchronization.

Use the data for useful summaries: three-putts per round, penalties, missed-fairway direction, and trends by course/tee/date. Do not label these as strokes-gained measurements without the necessary shot-level location/distance data.

Effort: medium–large. Validate whether players actually enter the extra fields during a round before expanding the model.

### Personal course insights

Implementation update (29 October): [personal course insights](roadmap-course-insights-2026-10-29.md) now cover per-hole gross averages against par, strongest/toughest holes, nine-hole and par-based comparisons, and the latest five matching rounds. Player, course/tee/version, date, practice and completion filters keep sample sizes explicit.

Use existing hole scores to show average score relative to par, strongest/toughest holes, front/back-nine splits, and performance on par 3/4/5 holes. Add “my last five rounds here” and comparable-round filters. Show sample sizes and separate incomplete rounds, 9/18 holes and team/individual scoring.

This extends existing best-round, scoring-distribution, handicap-input and form charts rather than duplicating them. Richer course insights can ship before additional stat entry because much of the source data already exists.

Effort: medium. Success: after a few rounds, a player can identify a specific recurring weakness rather than only see a total score.

### Goals and recaps

Allow optional personal goals and create a season recap using existing history and share-card rendering. Examples: number of rounds played, a target score on a chosen course, or fewer three-putts once putts are recorded. Avoid automatic public posting.

Effort: small–medium after the underlying statistics are consistent.

## Additional completeness work

- **Course corrections and versioning:** report incorrect tee ratings/hole data, review changes, and offer explicit updates to saved courses. Preserve the exact course snapshot used by historical rounds. Catalogue provenance already exists; add the maintenance workflow around it.
- **Front/back-nine and starting-hole selection:** model which holes are played and use the matching course/tee ratings. Do not infer one nine's rating by simply halving the full course. Useful for evening golf and events starting away from hole 1.
- **Merge duplicate players:** preview the affected history and links, choose the surviving identity and retain an undo record. This complements deletion and avoids losing continuity after imports or guest play.
- **Offline readiness:** [implemented 29 October](roadmap-offline-readiness-2026-10-29.md): saved setup/draft checks, actual app-cache verification, contextual local/account/live/tour status and upload retry. Before leaving home, show whether the chosen course and draft are available offline. During play, show saved locally, pending upload and last successful synchronization near the scorecard. Account-level sync information already exists; expose relevant state in context.
- **Recovery and portability:** extend existing JSON/Drive/PDF support with a trash/restore window, versioned restore previews and CSV export/import mapping. Avoid silent replacement when restoring a backup.
- **In-app help:** short explanations of handicap notation, local versus shared tours, scoring roles and offline behavior, plus a feedback form that lets users review any diagnostics before sending.

## Explore later

- GPS distances and hole maps: first establish a reliable, licensed source of course coordinates, permission/battery behavior and offline availability.
- Official handicap or golf-service integration: first verify provider access, permitted use and the complete applicable calculation/submission requirements. The current handicap chart records entered values; it is not an official handicap service.
- Smartwatch scoring: assess device demand and platform integration scope after the phone workflow is reliable.
- Automatic shot tracking and swing analysis: need new data collection and substantially more scope than the current scorecard model.

## External reference points

These are evidence that the workflows exist in established products, not proof that Poängbogey's users need all of them.

- [18Birdies statistics guide](https://help.18birdies.com/article/728-tracking-and-understanding-golf-statistics) documents putts, fairways, greens, penalties and filtered performance comparisons. Use it to inform an optional stats prototype.
- [Golf GameBook team tournament guide](https://tournamentmanager.zendesk.com/hc/en-us/articles/360016190340-How-to-Create-Team-Tournament) documents groups/start lists, tie-break choices, score editing and publishing results. These support investigating the organizer workflow as a coherent feature set.

## Recommended first choices

Build Play again/saved groups, QR/link joining and explain-my-points as focused additions. In parallel product planning, specify score correction/approval and draft recovery, since they affect the underlying round model. Then test optional stats and event scheduling with actual players and organizers before committing to GPS or watch integrations.
