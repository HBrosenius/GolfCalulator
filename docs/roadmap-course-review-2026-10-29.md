# Course corrections and versioning — 29 October 2026

Saved catalogue tees expose **Granska banversion** and **Rapportera fel**. Catalogue search also links to reporting and the signed-in user's prior reports. Reports identify an observed version, tee/rating category, field, optional hole, description and optional source URL. Authentication, input limits, per-account throttling and retry identifiers protect submission. A receipt and private report history show pending, accepted or rejected decisions and the maintainer's review note. Reports never directly publish catalogue changes.

## Explicit saved-course updates

A verified catalogue version is compared with all saved tees for that course. The preview shows old/new ratings, per-hole par/index, version and provenance, and lists new tees. Applying rechecks the catalogue and local library, then saves the batch in one local write. A failed write leaves the batch unchanged. Unverified updates, downgrades, conflicting catalogue identities and stale previews are refused. Renamed courses/tees or changed hole counts are listed as new entries; unmatched older entries remain separately saved, and the preview states this explicitly. Local custom values may be replaced only through this preview. Existing entries encountered during catalogue import use the same review flow.

Historical rounds now retain the course snapshots actually used, including catalogue provenance when present. Mixed-tee historical edits use saved subject ratings/rows for older rounds. New scorecards capture available tee data into the draft. Updating the library leaves these snapshots, history, goals and saved groups unchanged; future scorecards use the new library version. Older drafts lacking frozen tee data must be completed or removed before updating. Shared-tour starts use their frozen tour tees without writing them over the saved library.

## Maintainer review workflow

There is intentionally no public approval endpoint. A maintainer reviews the official club source and publishes a reviewed SQL migration through the existing staging/production deployment workflow.

1. Read open reports using the trusted D1 administrative connection, for example from `sync-worker/`:
   ```sh
   npx wrangler d1 execute golfcalc-accounts --env production --remote --command "SELECT id,course_id,observed_version,request_json,created_at,status FROM course_correction_reports WHERE status='open' ORDER BY created_at"
   ```
2. Retrieve the current complete course using `GET /courses/<id>`. Check the claimed correction against the official source, including rating category, hole count, par and unique stroke indices. Submitted links and descriptions are untrusted evidence, not publishing instructions.
3. Prepare a local JSON review input with `report` (`id`, `course_id`, `status: "open"`), `current` (complete current course), `decision` (`accepted` or `rejected`), `reason` (the review note), and `reviewedAt` (Unix milliseconds). Acceptance also requires `approved`: the complete verified course with official source metadata, version exactly one above current and a newer `updatedAt`. Rejection needs no approved course.
4. Generate and inspect the next numbered migration:
   ```sh
   node scripts/review-course-report.mjs /tmp/course-review.json > sync-worker/migrations/0015_review_course_report.sql
   ```
   Use the next available migration number. The generated SQL refuses a stale current version or an existing report already reviewed. A report may be absent in staging (or deleted with its account); publication of independently verified course data can still proceed, and the decision update is a no-op there. Keep the committed review note technical and public-safe; omit reporter details and copied report descriptions. Run it through the normal transactional D1 migration deployment; do not execute selected statements individually. Accepted versions publish and archive atomically with the report decision. Rejected reports retain the review note without changing the course.
5. Commit the reviewed migration and corresponding verified source dataset change, run release checks, then deploy staging before production. The app offers the published version for explicit local review and application.

Migration 0014 archives existing catalogue versions and enforces immutable version records and version increases for changed payload/provenance. `GET /courses/<id>` returns the latest published version without caching; `GET /courses/<id>/versions/<version>` returns an immutable archived version. Historical endpoints require the course to remain published. Private report responses use `no-store`. Reports accompany account exports and are deleted with the account. No genuine club data is corrected by this feature deployment.

## Validation

Coverage includes immutable version publication, stale review guards, authentication/ownership, idempotent submissions, invalid tee/version/links, report privacy, explicit/stale/unverified update previews, frozen mixed-tee ratings, and report retry/receipt flows. Browser checks cover desktop Chromium, mobile Chromium and iPhone WebKit.

Release gate: 159 root unit tests, 91 Worker tests and 274 browser checks passed; two expected WebKit offline/PWA checks are skipped. Both dependency audits report zero vulnerabilities. The final account-switch and phone-layout checks also passed.
