// Data loading for the study coach and spaced review, shared by the coach
// routes and the homepage. Everything is derived from the Attempt log.
const { subjectUnitDictionary } = require('../constants/subjects');
const { unitPerformance, recommend, dueReviews } = require('./coach');

const ATTEMPT_LIMIT = 3000;
const SUBJECTS = ['Physics', 'Chemistry', 'Biology', 'ESS'];

async function loadAttempts(mongo, user) {
  return mongo.Attempt.find({ user: user._id })
    .sort({ createdAt: -1 })
    .limit(ATTEMPT_LIMIT)
    .select(
      'question bank subject units correct rated userRatingBefore questionRatingBefore createdAt',
    )
    .lean();
}

async function buildCoach(mongo, user) {
  const attempts = await loadAttempts(mongo, user);
  const performance = unitPerformance(attempts);
  const subjects = {};
  for (const name of SUBJECTS) {
    const key = name.toLowerCase();
    const rating = user.rating ? user.rating[key] : undefined;
    if (!Number.isFinite(rating) || rating < 0) {
      continue;
    }
    const units = performance
      .filter((u) => u.subject === key)
      .sort((a, b) => a.residual - b.residual);
    const allUnits = (subjectUnitDictionary[name] || []).map(
      (unit) => `${name} - ${unit}`,
    );
    subjects[name] = {
      rating,
      units,
      recommendations: recommend(units, allUnits).map((r) => ({
        ...r,
        href:
          '/train/' +
          name +
          '/displayQuestion?units=' +
          encodeURIComponent(r.unit),
      })),
    };
  }
  const due = dueReviews(attempts).filter((d) => d.bank === 'standard');
  return {
    subjects,
    attemptsAnalysed: attempts.length,
    reviewDue: due.length,
    // lets the page and the tests say how much history backs the numbers
    truncated: attempts.length >= ATTEMPT_LIMIT,
  };
}

// a question is reviewable only while it is due for this user
async function dueEntry(mongo, user, questionId) {
  const attempts = await mongo.Attempt.find({
    user: user._id,
    question: questionId,
  })
    .sort({ createdAt: 1 })
    .select('question bank subject units correct createdAt')
    .lean();
  const [entry] = dueReviews(attempts);
  return entry && entry.bank === 'standard' ? entry : null;
}

async function countDueReviews(mongo, user) {
  const attempts = await loadAttempts(mongo, user);
  return dueReviews(attempts).filter((d) => d.bank === 'standard').length;
}

module.exports = {
  loadAttempts,
  buildCoach,
  dueEntry,
  countDueReviews,
  ATTEMPT_LIMIT,
};
