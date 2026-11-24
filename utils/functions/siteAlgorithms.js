// ---------------------------------------------------------------------------
// Rating engine
//
// Both the learner and the question carry a rating on a logistic scale where a
// 1000-point gap corresponds to 90 % expected success (base 9, scale 1000).
//
// v1 (legacy, kept as `calculateRatingsLegacy` for the simulation harness):
//   learner step  = round(16 * (outcome - p))             fixed K
//   question step = -round(learnerStep / 25)              zero when |step| < 13
// In v1 a question moves by only ~0.64 * (outcome - p), is frozen on near-even
// matches, and a brand-new learner converges at the same speed as a veteran.
//
// v2 follows the uncertainty-aware Elo of Pelanek (2016, "Applications of the
// Elo rating system in adaptive educational systems", Computers & Education
// 98): the step size is K(n) = K_inf * (1 + a / (1 + n / h)), shrinking with
// the number n of observations behind the rating, and the question is updated
// symmetrically with its own n instead of as a by-product of the learner step.
// ---------------------------------------------------------------------------
const RATING_SCALE = 1000;
const RATING_BASE = 9;

const ENGINE = Object.freeze({
  user: { kInf: 16, boost: 3, halfLife: 10 },
  question: { kInf: 8, boost: 5, halfLife: 30 },
});

function expectedScore(userRating, questionRating) {
  return (
    1 /
    (1 + Math.pow(RATING_BASE, (questionRating - userRating) / RATING_SCALE))
  );
}

function stepSize({ kInf, boost, halfLife }, attempts) {
  if (attempts === Infinity) {
    return kInf;
  }
  const n = Number.isFinite(attempts) && attempts > 0 ? attempts : 0;
  return kInf * (1 + boost / (1 + n / halfLife));
}

// params: ratings are numbers, correct is boolean (true = player got it right)
// opts.userAttempts / opts.questionAttempts: number of observations behind each
// rating. An omitted count means "established": the step size falls to its
// asymptotic floor (K = 16 for learners, 8 for questions).
function calculateRatings(userRating, questionRating, correct, opts = {}) {
  const outcome = correct ? 1 : 0;
  const p = expectedScore(userRating, questionRating);
  const kUser = stepSize(
    ENGINE.user,
    opts.userAttempts === undefined ? Infinity : opts.userAttempts,
  );
  const kQuestion = stepSize(
    ENGINE.question,
    opts.questionAttempts === undefined ? Infinity : opts.questionAttempts,
  );

  const userStep = Math.round(kUser * (outcome - p));
  const questionStep = Math.round(-kQuestion * (outcome - p));

  return {
    newUserRating: Math.max(1, userRating + userStep),
    newQuestionRating: Math.max(1, questionRating + questionStep),
  };
}

// the pre-v2 rule, retained verbatim so the two can be compared offline
function calculateRatingsLegacy(userRating, questionRating, correct) {
  const chanceOfCorrect = expectedScore(userRating, questionRating);
  const userRatingChange = Math.round(16 * (correct - chanceOfCorrect));
  const questionRatingChange = -Math.round(userRatingChange / 25);
  return {
    newUserRating: Math.max(1, userRating + userRatingChange),
    newQuestionRating: Math.max(1, questionRating + questionRatingChange),
  };
}

// input user rating, gives range of ratings for next question's selection
function ratingCeilingFloor(userRating) {
  let spread = Math.round((Math.random() + 2.7) * (Math.random() + 0.8) * 100);
  spread += Math.round(userRating / 10);

  let floor = userRating - spread;
  const ceiling = userRating + spread;
  if (floor < 0) {
    floor = 0;
  }

  return { floor: floor, ceiling: ceiling };
}

function calculateLevel(experience) {
  // if experience doesn't exist
  if (!experience) {
    experience = 0;
  }

  let total = experience;
  let level = 1;
  let decrement = 1000 * Math.pow(level, 1.21);

  while (total - decrement >= 0) {
    total -= decrement;
    level += 1;
    decrement = 1000 * Math.pow(level, 1.21);
  }

  return {
    level,
    remainder: Math.round(total),
    totalToNext: Math.round(decrement),
  };
}

function analyze(unitData) {
  const strengths = {
    physics: [],
    biology: [],
    chemistry: [],
    usabo: [],
    ess: [],
  };
  const weaknesses = {
    physics: [],
    biology: [],
    chemistry: [],
    usabo: [],
    ess: [],
  };
  const studying = {
    physics: [],
    biology: [],
    chemistry: [],
    usabo: [],
    ess: [],
  };
  const favorites = {
    physics: [],
    biology: [],
    chemistry: [],
    usabo: [],
    ess: [],
  };

  for (const [unit, data] of Object.entries(unitData)) {
    const performance = data.pastResults.reduce((a, b) => a + b, 0);
    const averageRating =
      data.pastRatings.reduce((a, b) => a + b, 0) / data.pastRatings.length;

    if (
      performance >= 10 ||
      (performance >= 5 && averageRating >= 2500) ||
      (performance >= 3 && averageRating >= 3500)
    ) {
      strengths[unit.split(' ')[0].toLowerCase()].push('' + unit);
    } else if (
      performance <= -7 ||
      (performance <= -5 && averageRating <= 2000) ||
      (performance <= -3 && averageRating <= 1500)
    ) {
      weaknesses[unit.split(' ')[0].toLowerCase()].push('' + unit);
    } else {
      studying[unit.split(' ')[0].toLowerCase()].push('' + unit);
    }

    if (data.correct + data.wrong >= 100) {
      favorites[unit.split(' ')[0].toLowerCase()].push('' + unit);
    }
  }

  return { strengths, weaknesses, studying, favorites };
}

module.exports = {
  calculateRatings,
  calculateRatingsLegacy,
  expectedScore,
  stepSize,
  ENGINE,
  ratingCeilingFloor,
  calculateLevel,
  analyze,
};
