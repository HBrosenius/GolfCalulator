# Scheduled tour events, groups and tee times — 28 October 2026

Shared tours now have **Speldagar och starttider**. An organizer or appointed administrator can create a dated event, select a tour course and IANA time zone, assign manual groups of 1–4 roster players and give each group a tee time. A player can appear in only one group per event. Each tour supports up to 50 events and each event up to 25 groups; players need not all be assigned.

Members select a player under **Visa mina starter för** to see that player's scheduled group, date, tee time and venue time zone. This is a display preference, separate from account membership or scoring authority. Schedules are private to tour members; spectator results do not disclose the event start list.

## Playing and calendar files

**Starta gruppens scorekort** uses the event's course, assigned players and played date, then opens the existing setup review for tees/handicaps and scoring format. Future-day starts are disabled using the venue time zone. An existing draft is preserved. A changed or cancelled event cannot be confirmed from an older setup dialog once the updated schedule is known. Round completion and tour results continue through the normal scoring, approval and result-management workflow. This release does not add per-event leaderboards or permanently attach a completed round to an event ID.

**Kalender (.ics)** exports one group's start as a calendar file. It contains player names, course, notes and a credential-free app link. UTC times preserve the venue's time zone conversion. Nonexistent or ambiguous daylight-saving transition times are rejected. Calendar text is escaped and folded by UTF-8 byte length; stable group/event IDs and incrementing sequence values support later updates. Estimated duration is 150 minutes for nine holes and 300 minutes for eighteen holes.

Calendar files are manual exports, not a live calendar subscription. Changed, removed or cancelled groups do not automatically update a calendar application; export/import the current file or manage old entries there. Cancelled events retain their groups and export cancellation status with the same calendar identity.

## Synchronization and editing

Event creation checks the tour revision; edits check the event revision. Stale edits retain the form and require refreshing. Retry IDs avoid duplicate creation or edits. Duplicate player assignments, invalid dates/time zones, unknown courses/members and overfull groups are rejected by the Worker and browser. Tour dates cannot be shortened past a scheduled event. Closed tours retain readable schedules but cannot change them. Scheduled venue days can extend the automatic tour deadline past midnight UTC, so late events remain scoreable until their venue-local day ends; cancellation/rescheduling recomputes that extension. A cancelled tour also exports its retained events as cancelled calendar entries.

Events live in separate Durable Object records, avoiding growth of the main tour record. Event updates, append-only before/after event audit records, retry records and the tour schedule revision commit atomically. Event history follows tour retention/deletion; the audit is currently server-side evidence, without a dedicated history browser.

Private schedule refresh and event-change WebSocket signals update the member view. Existing account notifications announce schedule changes. Events are cached on each device and re-fetched from the server across devices; they are not an additional JSON/account-backup collection. Cached views and exported calendars can become stale while offline, so refresh the start list before playing. Account switches discard in-flight schedule responses.

Randomized/balanced pairings, availability polling, starting-hole/shotgun planning, tee-time booking and event-specific competition rules remain later work. This increment is a manual planning and scorecard-setup workflow, not an external booking or calendar-writing integration.

## Verification

Tests cover private access, role restrictions, event validation, stale/concurrent edits, retries, date constraints, broadcasts, DST gaps/overlaps, fractional-offset zones, calendar injection/line folding, personal assignments, cancellation IDs, group scorecard setup, draft preservation, account isolation and stale setup dialogs. Production smoke creates and cancels an event in a synthetic tour, then removes the tour.

Release verification passed: 128 root unit tests, 79 Worker tests and 194 browser checks, with one expected WebKit PWA skip. Both dependency audits were clear and Worker deployment dry runs passed.
