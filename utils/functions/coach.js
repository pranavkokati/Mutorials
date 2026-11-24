// Study coach analytics and spaced-review scheduling.
//
// Everything here is a pure function of the user's append-only Attempt log, so it
// needs no new collection and can be tested without a database. See docs/COACH.md
// for the statistical reasoning.
const { expectedScore } = require('./siteAlgorithms');

const DAY_MS = 24 * 60 * 60 * 1000;

const COACH = Object.freeze({
  // attempts lose half their weight every HALF_LIFE_DAYS
  halfLifeDays: 45,
  // pseudo-observations of "performing exactly at rating" blended into every unit
  priorStrength: 6,
  // minimum effective (recency-weighted) attempts before a unit is classified
  minEffective: 5,
  // classification thresholds: shrunken mean residual, and a one-sided 5 % z test
  weakResidual: -0.08,
  strongResidual: 0.08,
  zThreshold: 1.645,
});

// Leitner boxes: days to wait after the last attempt, by box. Passing the last
// box graduates the question out of the queue.
const REVIEW_INTERVAL_DAYS = Object.freeze([1, 3, 7, 14, 30]);

/**
 * Per-unit performance relative to what the learner's own rating predicts.
 *
 * Raw accuracy is a poor weakness signal here: the trainer deliberately serves
 * questions near the learner's rating, so accuracy hovers around 50 % in every
 * unit. The informative quantity is the residual, `correct - expectedScore`,
 * where the expectation uses the learner and question ratings recorded at the
 * time of the attempt.
 *
 * For unit u with recency weights w_i and residuals r_i = y_i - p_i:
 *   W = sum w_i                       effective number of attempts
 *   R = sum w_i r_i
 *   shrunken mean residual m = R / (W + k)       k = prior strength (towards 0)
 *   z = R / sqrt(sum w_i^2 p_i (1 - p_i))        evidence that the true mean != 0
 *
 * A negative m means "worse than your overall level in this subject", so the
 * assessment is relative to the learner, not absolute.
 *
 * attempts: [{ subject, units, correct, rated, userRatingBefore,
 *              questionRatingBefore, createdAt }]
 */
function unitPerformance(attempts, now = Date.now(), options = {}) {
  const cfg = { ...COACH, ...options };
  const byKey = new Map();

  for (const a of attempts) {
    if (
      a.rated === false ||
      !Number.isFinite(a.userRatingBefore) ||
      a.userRatingBefore < 0 ||
      !Number.isFinite(a.questionRatingBefore) ||
      !Array.isArray(a.units)
    ) {
      continue;
    }
    const ageDays = Math.max(
      0,
      (now - new Date(a.createdAt).getTime()) / DAY_MS,
    );
    const w = Math.pow(0.5, ageDays / cfg.halfLifeDays);
    const p = expectedScore(a.userRatingBefore, a.questionRatingBefore);
    const residual = (a.correct ? 1 : 0) - p;
    for (const unit of new Set(a.units)) {
      const key = `${a.subject}\u0000${unit}`;
      const cell = byKey.get(key) || {
        subject: a.subject,
        unit,
        attempts: 0,
        correct: 0,
        W: 0,
        R: 0,
        V: 0,
        expectedSum: 0,
        lastAt: 0,
      };
      cell.attempts += 1;
      cell.correct += a.correct ? 1 : 0;
      cell.W += w;
      cell.R += w * residual;
      cell.V += w * w * p * (1 - p);
      cell.expectedSum += p;
      cell.lastAt = Math.max(cell.lastAt, new Date(a.createdAt).getTime());
      byKey.set(key, cell);
    }
  }

  return [...byKey.values()].map((cell) => {
    const residual = cell.R / (cell.W + cfg.priorStrength);
    const z = cell.V > 0 ? cell.R / Math.sqrt(cell.V) : 0;
    let status = 'insufficient';
    if (cell.W >= cfg.minEffective) {
      if (residual <= cfg.weakResidual && z <= -cfg.zThreshold) {
        status = 'weak';
      } else if (residual >= cfg.strongResidual && z >= cfg.zThreshold) {
        status = 'strong';
      } else {
        status = 'on-track';
      }
    }
    return {
      subject: cell.subject,
      unit: cell.unit,
      attempts: cell.attempts,
      effectiveAttempts: round(cell.W, 2),
      accuracy: round(cell.correct / cell.attempts, 3),
      expectedAccuracy: round(cell.expectedSum / cell.attempts, 3),
      residual: round(residual, 3),
      z: round(z, 2),
      status,
      lastAttempt: new Date(cell.lastAt).toISOString(),
    };
  });
}

function round(value, digits) {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

/**
 * Picks what to study next in one subject: the weakest classified units first
 * (most negative shrunken residual), then, as exploration, units the learner has
 * never been rated on. `allUnits` is the full list of units for the subject in
 * the "Subject - Unit" form used in the Attempt log.
 */
function recommend(performance, allUnits, limit = 3) {
  const weak = performance
    .filter((u) => u.status === 'weak')
    .sort((a, b) => a.residual - b.residual)
    .slice(0, limit)
    .map((u) => ({ unit: u.unit, reason: 'weak', residual: u.residual }));
  if (weak.length >= limit) {
    return weak;
  }
  const seen = new Set(performance.map((u) => u.unit));
  const unseen = allUnits
    .filter((unit) => !seen.has(unit))
    .slice(0, limit - weak.length)
    .map((unit) => ({ unit, reason: 'unexplored' }));
  return [...weak, ...unseen];
}

/**
 * Leitner state for one question from its chronological attempts.
 * A question enters the queue on its first miss (box 0). Each later correct
 * answer moves it up a box; a miss sends it back to box 0. Answers on a question
 * that has never been missed are ignored. Returns null if never missed.
 */
function reviewState(chronologicalAttempts) {
  let box = -1;
  let lastAt = null;
  for (const a of chronologicalAttempts) {
    const at = new Date(a.createdAt).getTime();
    if (!a.correct) {
      box = 0;
      lastAt = at;
    } else if (box >= 0) {
      box += 1;
      lastAt = at;
    }
  }
  if (box < 0) {
    return null;
  }
  if (box >= REVIEW_INTERVAL_DAYS.length) {
    return { box, graduated: true, lastAt, dueAt: null };
  }
  return {
    box,
    graduated: false,
    lastAt,
    dueAt: lastAt + REVIEW_INTERVAL_DAYS[box] * DAY_MS,
  };
}

/**
 * Builds the due-review list from a user's attempts (any order).
 * Returns [{ question, box, dueAt, overdueDays, subject, units }] ordered by how
 * overdue each item is relative to its interval.
 */
function dueReviews(attempts, now = Date.now()) {
  const byQuestion = new Map();
  for (const a of attempts) {
    const key = String(a.question);
    if (!byQuestion.has(key)) {
      byQuestion.set(key, []);
    }
    byQuestion.get(key).push(a);
  }
  const due = [];
  for (const [question, list] of byQuestion) {
    list.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
    const state = reviewState(list);
    if (!state || state.graduated || state.dueAt > now) {
      continue;
    }
    const interval = REVIEW_INTERVAL_DAYS[state.box] * DAY_MS;
    const latest = list[list.length - 1];
    due.push({
      question,
      box: state.box,
      dueAt: new Date(state.dueAt).toISOString(),
      overdueDays: round((now - state.dueAt) / DAY_MS, 1),
      overdueRatio: (now - state.dueAt) / interval,
      subject: latest.subject,
      bank: latest.bank || 'standard',
      units: latest.units || [],
    });
  }
  return due.sort((a, b) => b.overdueRatio - a.overdueRatio);
}

module.exports = {
  COACH,
  REVIEW_INTERVAL_DAYS,
  unitPerformance,
  recommend,
  reviewState,
  dueReviews,
};
