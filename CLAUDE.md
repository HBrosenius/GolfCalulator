# GolfCalculator

Single-file PWA for scoring golf rounds (Swedish UI). No build step, no dependencies,
no package.json — everything lives in `index.html` (~4800 lines: HTML + `<style>` + `<script>`
inline). Just open the file / serve statically.

## Files
- `index.html` — the entire app (markup, CSS, JS in one file)
- `sw.js` — service worker (PWA offline support)
- `manifest.json`, `icon-*.png`, `apple-touch-icon.png` — PWA metadata/icons
- `README.md` — user-facing feature documentation (Swedish); update when adding features

## Persistence
All data lives in `localStorage`, no backend/database:
- `golf_courses_db` (`DB_KEY`) — saved courses (tees, slope/CR, par per hole)
- `golf_rounds_db` (`ROUNDS_KEY`) — completed rounds
- `golf_players_db` (`PLAYERS_KEY`) — player register (name, nick, photo)
- `golf_theme` (`THEME_KEY`) — light/dark theme
- `golf_last_cloud_backup` (`LAST_BACKUP_KEY`) — Google Drive backup timestamp (`golf-backup-*.json`, legacy filename `golf-backup.json`)

## Core data model
A round: `{ id, date, courseName, tee, mixedTees, holes, slope, cr, par, gameMode, subjects }`
where `subjects` is an array of `{ name, hi, ph, tee, slope, cr, par, totalPoints, totalBrutto, members, teamId, teammate, rows }`.

`gameMode` ∈ `individual | scramble | fourball | foursome | match`.
**Scramble/Foursome share one team score** — not attributable to an individual player, so
these modes are excluded from any per-player stat (Season/Order of Merit, Course Records,
Hall of Fame win counts, etc.). Follow this precedent for new stats.

## Key patterns
- `escapeHtml(s)` (line ~1187) — **always** wrap user-controlled strings before inserting into
  `innerHTML`. A past commit (`8841cd2`) fixed a stored-XSS bug from missing this.
- `avatarHtml(photo, cls)` — renders a player photo `<img>` or a 🏌️ emoji placeholder; reuse
  for consistent avatars across leaderboard-style views.
- View toggling: full-screen sections are sibling `<div>`s toggled via `.hidden` class, with
  `open*View()` / `close*View()` function pairs (e.g. `openHallOfFame`, `openSeasonView`,
  `openCourseRecordsView`). New views must hide `playersView` on open and restore it on close.
- Print CSS: `body.printing-history #id { display:none !important; }` — any new overlay view
  must be added to this rule so it doesn't leak into printed round history.
- Grouping key for per-course stats: `` `${courseName}||${holes}` `` (course + hole count；
  add `||tee` only if grouping needs to be tee-specific).

## Conventions
- UI copy is Swedish; match existing tone/terminology.
- No frameworks, no npm — plain DOM APIs and template strings only.
- Git: never `git add -A`/`git add .` — stage files by name.
