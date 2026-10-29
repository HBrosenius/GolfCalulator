# Offline readiness and scorecard synchronization — 29 October 2026

Before play, **Spara och kontrollera offline** on the player setup screen validates the setup, saves a recoverable draft with its course/tee data, and checks the installed app's actual active cache. It checks the application shell and the script URLs required by the current page. Missing resources, unavailable service workers, and unanswered checks report that offline readiness could not be verified. An online network indicator alone never confirms offline readiness.

The scorecard now shows local draft save progress and successful save time separately from app-cache readiness, account sync, live score uploads, and tour-result submission. The result screen retains the relevant upload status and retry action. Completed-round edits explicitly require calculating the result again to save them.

- Draft save confirmation follows a successful IndexedDB write. An older queued save cannot overwrite the status of a newer pending save. Errors stay visible and can be retried. The existing localStorage recovery checkpoint remains available.
- Drafts remain local; account sync covers saved rounds and courses, not draft handoff. A successful account sync does not imply that a tour submission or live score push succeeded.
- Live uploads remain pending until an acknowledged response; the existing dirty-seat controller handles retries. Live status describes changes queued in the current view. Live upload times are acknowledgments observed during this app session.
- Tour uploads use the existing durable submission queue. Queue failures and server errors remain visible without deleting the local result. Retry can requeue a locally saved tour result if necessary and retains the same client round identity for server idempotency. Acknowledgment is separate from organizer approval.
- Account sync shows the existing last successful sync time and current error/conflict state. Conflicts route to the existing review panel. Account-scoped draft/upload status cannot confirm another account's data.

Cache checks are point-in-time observations; browser storage eviction can still occur later. Recheck before leaving network coverage. This feature does not request persistent storage, create account-synced drafts, or change the authoritative tour protocol. Tour/live timestamps in this view reflect this session; durable account sync metadata and queued tour errors retain their existing persistence.

Browser coverage verifies saving before play, offline score persistence, failed local writes and retry, failed live pushes and acknowledged retry, failed tour uploads and acknowledged retry, account isolation, cached shell completeness, and offline reload/resume. Playwright WebKit's existing service-worker offline-navigation limitation remains a skipped physical-iOS validation case; its local-save/upload status coverage runs normally.
