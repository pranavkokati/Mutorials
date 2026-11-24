# Adaptive rating engine (v2)

Mutorials chooses each practice question from a rating window around the
learner's current rating and updates both ratings after every answer. This
document specifies the update rule, explains why it replaced the original, and
reports what an offline simulation does and does not show.

## Model

Both learners and questions carry a rating on a logistic scale in which a
1000-point gap corresponds to a 90 % expected success rate:

    p(correct) = 1 / (1 + 9^((q - u) / 1000))

where `u` is the learner's rating in the subject and `q` is the question's.

## The legacy rule (v1) and its weaknesses

    learner step  = round(16 * (outcome - p))
    question step = -round(learner step / 25)

1. **The question is nearly frozen.** Its effective step size is 16 / 25 =
   0.64 rating points per unit of surprise, and it is rounded to an integer, so
   it is exactly zero whenever the learner step is below 13 in magnitude. That
   is every near-even match. Contributor-assigned starting ratings therefore
   never get corrected by the data.
2. **Learners converge at one fixed speed.** A newcomer who picked a coarse
   self-placement at sign-up needs as many answers to reach their true level as
   a veteran needs to correct a one-off slump.

## The v2 rule

Step sizes follow the uncertainty-aware Elo of Pelánek (2016, "Applications of
the Elo rating system in adaptive educational systems", _Computers &
Education_ 98): the step is large while few observations stand behind
a rating and decays towards a floor as evidence accumulates.

    K(n) = K_inf * (1 + a / (1 + n / h))

    learner step  = round( K_user(n_user)     * (outcome - p))
    question step = round(-K_question(n_question) * (outcome - p))

| Rating   | K_inf | a   | h (half-life, answers) | K at n = 0 | K at n = 100 |
| -------- | ----- | --- | ---------------------- | ---------- | ------------ |
| Learner  | 16    | 3   | 10                     | 64         | 20.4         |
| Question | 8     | 5   | 30                     | 48         | 17.2         |

- `n_user` is the per-subject count in `stats.attempts.<subject>`, incremented
  atomically with the rating update. Accounts that predate the counter are
  seeded once from their lifetime `stats.correct + stats.wrong`. That figure
  spans all subjects and so over-counts; the effect is a calmer rating, never an
  erratic one.
- `n_question` is `stats.pass + stats.fail`.
- Ratings are clamped to a minimum of 1 and stay integers, so no schema or
  question-selection code changed.
- The learner floor (16) equals the legacy constant, so established learners
  see almost the same step as before. The change is concentrated where the
  evidence is thin.

### Provenance of the constants

`K_user` keeps the legacy 16 as its floor. The multiplier and half-life
(`a = 3`, `h = 10`) were set by judgement to give a newcomer a four-fold
initial step that is within 25 % of the floor after about 110 answers. The
question constants came from a coarse sweep in the simulator below:

| K_inf (question) | h (question) | Learner RMSE @150 | Question RMSE @150 |
| ---------------- | ------------ | ----------------- | ------------------ |
| 4                | 10           | 178               | 444                |
| 4                | 30           | 173               | 393                |
| 8                | 10           | 177               | 347                |
| 8                | 30           | 182               | 297                |
| 12               | 10           | 181               | 297                |
| 12               | 30           | 192               | 262                |

(6 seeds, clean scenario.) Faster question updates lower question error and
raise learner error slightly, since the two ratings are coupled. `8 / 30` is a
middle setting, not an optimum; the sweep is in the simulator's own world and
should not be read as a tuned result for real learners.

## Simulation

`node scripts/elo-sim.js [--seeds 10] [--users 300] [--questions 400] [--rounds 150] [--guess 0.2] [--json]`

300 simulated learners (ability ~ N(2500, 800)) answer 150 questions each from
a pool of 400 (difficulty ~ U(500, 4500)). Learner ratings start as ability
plus N(0, 700) noise, question ratings as difficulty plus N(0, 600) noise.
Questions are drawn from the production `ratingCeilingFloor` window. Seeds are
shared between the two engines (paired design); the table gives mean ± sd over
10 seeds.

**Clean scenario** (responses follow the model exactly):

| Round | Engine | Learner RMSE | Question RMSE | Log-loss  |
| ----- | ------ | ------------ | ------------- | --------- |
| 25    | v1     | 607 ± 24     | 592 ± 17      | 0.691     |
| 25    | v2     | 500 ± 23     | 492 ± 16      | 0.675     |
| 50    | v1     | 533 ± 22     | 591 ± 17      | 0.688     |
| 50    | v2     | 395 ± 19     | 433 ± 18      | 0.671     |
| 100   | v1     | 404 ± 16     | 590 ± 17      | 0.691     |
| 100   | v2     | 260 ± 18     | 355 ± 20      | 0.661     |
| 150   | v1     | 295 ± 13     | 586 ± 17      | 0.675     |
| 150   | v2     | **182 ± 15** | **301 ± 19**  | **0.619** |

**Guessing scenario** (`--guess 0.2`: 20 % floor, i.e. misspecified model):
at round 150, learner RMSE 387 → 278, question RMSE 587 → 338, log-loss
0.722 → 0.686 (v1 → v2).

### How to read this

- v2 reaches a given learner accuracy in roughly half the answers. At round
  150 learner error is about 38 % lower in the clean scenario and 28 % lower
  under the guessing floor. Question error falls by about half; under legacy
  rules it stays at its starting value, as the analysis predicts.
- Log-loss is close to ln 2 = 0.693 for both engines because the trainer picks
  questions near the learner's rating, so outcomes are close to coin flips by
  construction. Differences in log-loss are real but small in absolute terms.
- **Caveats.** The simulator generates responses from the same logistic the
  engines assume, so absolute errors are optimistic. Learners do not improve
  during the run, although real learners do, which favours slower-adapting
  rules in practice. Question selection uses a snapshot of rating order per
  round. No real response data were used, and constant choices (`a`, `h`,
  `K_inf`) are not validated against real learner outcomes. Confidence that v2
  outperforms v1 **in simulation**: high. Confidence in the magnitude on real
  users: low. The `Attempt` collection records every rated answer with
  before/after ratings, so the same comparison can be replayed on production
  data once enough has accumulated.

## Operational notes

- No migration is required. Missing counters are seeded lazily.
- Existing question ratings will now drift. Questions with few recorded
  attempts move fastest, which is the intended correction of contributors'
  initial guesses.
- To compare variants, edit `ENGINE` in `utils/functions/siteAlgorithms.js` and
  rerun the simulator. The legacy rule is kept as `calculateRatingsLegacy` for
  this purpose and is not used by the application.
