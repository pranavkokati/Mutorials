# Changelog

## Unreleased

### Added

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
