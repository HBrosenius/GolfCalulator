# Personal course insights — 29 October 2026

Available under **Statistik → Mina baninsikter**, and from each player's history.

Select a player and a course/tee/hole-count comparison, optionally filtered by date. The view shows:

- Mean gross strokes relative to par on each hole, with the number of observations.
- Strongest and toughest holes, including ties.
- Front/back-nine averages per hole, and averages on par 3/4/5 holes (par 6 appears if recorded).
- The five latest matching rounds by played date, with gross strokes and score relative to par.

Only individual scorecards enter this comparison. Fourball, match, scramble and foursome are excluded. Player matching uses the existing stable identity logic; an explicit different player ID cannot match by name. Duplicate matching subjects are rejected.

Complete competitive scorecards are the default. Practice rounds and incomplete scorecards are separate filter choices. An incomplete scorecard contributes only positively scored, non-pickup holes, and its displayed totals are explicitly partial. Unanswered and pickup holes never become zero scores. Draft/in-progress records are excluded. Historical records without a round-kind field retain the existing competitive default.

Course name, tee, hole count, course rating, slope and the recorded per-hole par layout define a comparison group. Changed ratings or par layouts remain separate versions. Unknown historical ratings are shown as unknown and kept separate from known ratings. Hole numbers use the stored sequence; this does not add back-nine or starting-hole selection to older scorecards. Courses with identical names and snapshots remain indistinguishable in legacy history.

No new data collection or backup schema is required. The helper reads existing round snapshots, and is included in the offline application shell. Small samples are identified, with a reminder that comparisons may be uncertain. These are gross-score comparisons, not handicap-adjusted or strokes-gained statistics.

Verification includes deterministic tests of grouping, identity, completion, date order, sampling and hole/par summaries; browser coverage checks filters, navigation, empty states and mobile width in all three configured browser projects. The release gate covers the existing application and Worker suites.
