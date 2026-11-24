# Item analysis for contributors

`/contributors/items` (JSON at `/contributors/items/data`) shows each author how
their published multiple-choice, select-all and free-response questions are
behaving. It is derived from the `Attempt` log and is available only to the
author (admins may pass `?id=` to inspect another author). Responses contain
aggregate counts only: no user ids, names or per-learner records.

## What is measured

**Calibration.** For every rated attempt the log holds the learner and question
ratings before the answer, hence the expected pass probability `p_i`. With `n`
attempts and `k` passes, `z = (k - sum p_i) / sqrt(sum p_i (1 - p_i))`. With at
least 30 attempts, `z <= -1.96` is reported as "harder than rated" and
`z >= +1.96` as "easier than rated"; otherwise "calibrated" (fewer than 30:
"need 30 answers"). Because ratings adapt (see [RATING.md](RATING.md)), a
miscalibrated question should drift towards calibration on its own; a flag that
persists points to a question whose difficulty is unstable or whose wording
misleads.

**Option usage (multiple choice only).** The chosen option is stored with each
new attempt (`choice`, option numbers only; free-response text is never
stored). Option shares are shown once at least 10 choices are recorded, so a
handful of answers cannot be traced to individuals. Answers given before this
feature have no recorded choice and are excluded from option statistics.

**Flags.**

- _Unused distractor_: a wrong option chosen by fewer than 5 % of at least 30
  recorded choices.
- _Possible key error or ambiguity_: among attempts by learners expected to
  succeed (`p >= 0.75`, at least 10 of them), some wrong option is chosen more
  often than the keyed one. If ratings are calibrated, a correctly keyed question is answered
  correctly by roughly three quarters or more of such learners, so this pattern
  is rare unless the key is wrong or two options are defensible.

## How to read it

Flags are prompts to re-read a question, not verdicts. Limits: the key-error
test has no multiple-comparison correction across an author's questions and
uses the rating model's expectation, which is itself estimated; the unused
distractor rule says nothing about distractors that attract only weak learners;
select-all questions receive calibration only; USABO and free-response items
receive no option analysis. The thresholds (30, 10, 5 %, 0.75, 1.96) are
conventional choices, not values fitted to Mutorials data, and the flag rates
have not been measured on real questions. Confidence in the logic: high (unit
and route tests). Confidence in the usefulness of the thresholds on the real
question bank: unknown until data accumulates.

## Privacy

`Attempt.choice` is linked to a user in the stored log, like every other
attempt field, and is used here only after aggregation. It is limited to option
numbers; the form value is validated against the question's option count before
being stored.
