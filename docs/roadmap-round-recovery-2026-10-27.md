# Local round recovery and historical entry — 27 October 2026

This increment adds multiple named scorecard drafts, local deletion recovery and historical played dates.

## Behavior

- The start page lists saved drafts. Pausing a scorecard and starting another preserves both; each can be resumed or permanently deleted.
- Drafts use IndexedDB transactions, revisions and account/API-specific vaults. A stale tab saves a separate conflict copy rather than overwriting newer scores. The legacy latest-scorecard checkpoint is retained and migrated, including after a failed database write. Navigation that would replace a scorecard waits for its save and stops on failure.
- Completed rounds retain their source draft identity. Recalculating the results updates the completed round instead of creating another copy.
- Deleting a completed round first archives it locally, then records the synchronized deletion tombstone. History offers restoration for 30 days. Restoration creates a new local identity, preserves the original tombstone and removes shared-tour submission context. It does not restore a shared-tour result.
- Played date and ordinary/practice classification are chosen before scoring and retained in live rooms and completed history. Practice rounds are excluded from local and shared tour standings. Dedicated tour setup enforces its date window and competitive classification.
- Completed history identifies practice rounds, pending submissions and restored copies.

## Limits and next work

Drafts and trash are local to this browser, separated by account and API endpoint. They are not included in account sync or JSON backups; clearing site data or losing the device removes them. Live credentials remain only in the local draft vault. Account-synced draft handoff requires a separate credential-safe design.

The vault allows 100 drafts and 200 trash entries. Trash expires after 30 days. Restore is retry-safe with a stable replacement identity. Gross-total-only historical entry, shared-tour score correction/approval and cross-device draft handoff remain outside this increment.

## Verification

The release gate passed: 113 root unit tests, 62 Worker tests and 155 browser checks across Chromium, mobile Chromium and WebKit, with one expected WebKit PWA skip. JavaScript checks and both dependency audits passed (zero vulnerabilities). Recovery browser cases exercise multiple drafts across reloads, historical practice entry, repeat calculation, trash restore with deletion tombstones retained, stale-tab conflicts, database write failure recovery and guest/account isolation.
