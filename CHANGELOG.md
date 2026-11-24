# Changelog

## Unreleased

### Added

- **Redesigned signed-in app** ("an answer sheet on a desk"): new type
  (Instrument Sans for the interface, Source Serif 4 for question text, both
  self-hosted with a Greek subset for physics), one ruled sheet instead of
  stacks of cards, highlighter and red-pen marks, scan-sheet answer bubbles, a
  single rating chart for all subjects, light and dark. The whole practice
  flow now uses it: unit picker, question, answer review, daily problem and
  proficiency. Problem Rush still has its old look.
- **Hosting on Vercel**: `api/index.js`, `vercel.json` and
  [docs/HOSTING.md](docs/HOSTING.md). The AI library is now an optional
  dependency so serverless installs skip about 700 MB.

- **New signed-in interface** (Tailwind, light/dark, keyboard and screen-reader
  friendly, no dependency on third-party scripts for navigation): shared app
  shell with an accessible nav, and redesigned home dashboard (rating cards
  with trend sparklines, review-due badge), training hub, subject picker,
  coach, spaced review, search and leaderboard. Other pages keep their old look
  until migrated.
- `npm run demo`: one-command local run with seeded data
  (see the README).
- **Adaptive rating engine v2** (uncertainty-aware K for learners and
  questions). Simulation and rationale: [docs/RATING.md](docs/RATING.md).
- **Study coach** (`/coach`) and **spaced review** (`/review`):
  [docs/COACH.md](docs/COACH.md).
- **Semantic search** ("Related by meaning" on `/search`) and the earlier AI
  helpers: [docs/AI.md](docs/AI.md).
- **Contributor item analysis** (`/contributors/items`):
  [docs/ITEM-ANALYSIS.md](docs/ITEM-ANALYSIS.md).
- `Attempt.choice` (chosen option numbers) and `User.stats.attempts.<subject>`
  (rated answers per subject).

### Fixed

- Success flash messages were silently dropped on the newer Tailwind pages
  (missing comma in `flashesV2.ejs`), and its Train/Stats nav links were
  relative, so they broke from any nested page.
- Search results listed only an ID; they now show the question text.
- Search page crashed when the keyword search found nothing (Express 5 query
  objects have no prototype).
- Wide-ranging security, correctness and platform fixes from the earlier
  overhaul; see the merged pull requests.

### Behaviour changes to know about

- Question ratings now move on every answer, fastest for questions with few
  attempts, so published ratings will drift towards observed difficulty.
- New learners' ratings move faster at first and settle as answers accumulate.
- Accounts that predate the per-subject attempt counter are seeded from their
  lifetime answer total on their next rated answer. No migration is needed.
- Option statistics cover only answers given after this release.

### Operations

- Production requires `DB_URL` and `SESSION_SECRET`.
- No new collections. Existing indexes are sufficient for the new queries
  (`attempts` is indexed by user and by question).
