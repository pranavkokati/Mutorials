# Study coach and spaced review

Both features are computed on demand from the append-only `Attempt` log (one row
per rated answer, written by `recordAnswer`). No new collection is needed and
nothing here affects ratings.

## Study coach (`/coach`, `/coach/data`)

### Why not raw accuracy

The trainer serves questions near the learner's rating, so expected accuracy is
close to 50 % in every unit by design. A unit showing 48 % accuracy is not
evidence of weakness. The informative quantity is the **residual**: whether the
learner did better or worse than their own rating predicted for the specific
questions they got.

### Method

For each attempt `i` the log records the learner and question ratings before the
answer, which give the expected score `p_i` (the same logistic as the rating
engine; see [RATING.md](RATING.md)). With outcome `y_i` and residual
`r_i = y_i - p_i`, and a recency weight `w_i = 0.5^(age_days / 45)`, a unit has

| Quantity                   | Definition                                     |
| -------------------------- | ---------------------------------------------- |
| effective attempts `W`     | `sum w_i`                                      |
| shrunken mean residual `m` | `sum(w_i r_i) / (W + 6)`                       |
| evidence `z`               | `sum(w_i r_i) / sqrt(sum w_i^2 p_i (1 - p_i))` |

The constant 6 is a prior: six pseudo-observations of "performing exactly at
rating", so a handful of answers cannot produce an extreme estimate.

Classification (`W` must be at least 5 or the unit is "Need more data"):

- **Weak spot**: `m <= -0.08` and `z <= -1.645`
- **Strength**: `m >= +0.08` and `z >= +1.645`
- otherwise **On track**

The assessment is relative to the learner's own level in that subject, not to
other learners. A question tagged with several units counts toward each of them
(each unit is analysed separately, so the units are not independent).

Recommendations are the weakest classified units, topped up with units the
learner has never been rated on. Each links to the existing trainer with that
unit preselected.

### Operating characteristics

`node scripts/coach-sim.js` simulates a learner rated 2000 answering questions
drawn from N(2000, 150) in a unit where their true level is `deficit` points
lower. Share of units classified "weak" (4000 trials per cell):

| True deficit | n=5  | n=10  | n=20  | n=40   |
| ------------ | ---- | ----- | ----- | ------ |
| 0 pts        | 0.0% | 5.3%  | 5.3%  | 5.0%   |
| 200 pts      | 0.0% | 16.7% | 23.6% | 38.1%  |
| 400 pts      | 0.0% | 37.5% | 58.7% | 83.7%  |
| 800 pts      | 0.0% | 80.7% | 97.2% | 100.0% |

Reading: the false-positive rate is about 5 % per unit (the z threshold), with
no unit classified below five effective answers. Moderate deficits (about 200
points) need many answers to be detected; large ones are found quickly. With
roughly a dozen units per subject, expect about one spurious "weak spot" per
subject for every twenty units checked, so the label should be read as "worth
practising", not as a diagnosis. An earlier threshold of `z = 1.28` raised the
false-positive rate to about 10 % and was rejected.

Limitations. The simulation uses the same response model as the coach, so
power is optimistic. Multiple units are tested at once and no correction is
applied. Only the most recent 3000 rated answers are analysed. Skipped
questions are not in the log and are ignored. Learners who improve over time
look weaker on old data; the recency weighting reduces but does not remove
this.

## Spaced review (`/review`)

A Leitner scheme over missed questions, derived from the log:

- A question enters the queue the first time it is answered wrong (box 0).
- Each later correct answer moves it up one box; a wrong answer returns it to
  box 0. Answers on a question that has never been missed are ignored.
- The wait after the last attempt is 1, 3, 7, 14 and 30 days for boxes 0-4.
  Passing box 4 clears the question.
- Review answers are logged with `rated: false, mode: 'review'`. They never
  change ratings, experience, tags or question statistics, so they cannot be
  used to farm progress. They also do not feed the coach.
- A question can only be answered in review while it is due for that learner,
  so replays, double submits and other users' questions are refused.

The interval schedule is a conventional choice, not one fitted to Mutorials
data. The `Attempt` log is sufficient to fit one later.
