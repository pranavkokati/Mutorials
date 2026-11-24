// Study coach (weak-spot analysis) and spaced-review queue.
// Both are derived from the append-only Attempt log; see docs/COACH.md.
const { subjectUnitDictionary } = require('../utils/constants/subjects');
const {
  unitPerformance,
  recommend,
  dueReviews,
  REVIEW_INTERVAL_DAYS,
} = require('../utils/functions/coach');
const { gradeAnswer } = require('../utils/functions/answers');
const { toObjectId } = require('../utils/functions/ids');
const { wrap } = require('../utils/functions/http');
const { toPlainText, describeCorrect } = require('../utils/ai/text');

const VIEWS = __dirname + '/../views/';
const ATTEMPT_LIMIT = 3000;
const REVIEW_PAGE = 25;
const SUBJECTS = ['Physics', 'Chemistry', 'Biology', 'ESS'];

const snippet = (html, max = 180) => {
  const text = toPlainText(html, 600).replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

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

module.exports = (app, mongo) => {
  app.all(/^\/(coach|review)(\/.*)?$/, (req, res, next) => {
    if (req.isAuthenticated()) {
      return next();
    }
    req.flash(
      'errorFlash',
      'Error 401: Unauthorized. You need to login to see this page.',
    );
    res.redirect('/');
  });

  app.get(
    '/coach/data',
    wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await buildCoach(mongo, req.user));
    }),
  );

  app.get(
    '/coach',
    wrap(async (req, res) => {
      res.render(VIEWS + 'private/coach.ejs', {
        coach: await buildCoach(mongo, req.user),
        pageName: 'Study Coach',
      });
    }),
  );

  app.get(
    '/review',
    wrap(async (req, res) => {
      const attempts = await loadAttempts(mongo, req.user);
      const due = dueReviews(attempts)
        .filter((d) => d.bank === 'standard')
        .slice(0, REVIEW_PAGE);
      const questions = await mongo.Ques.find({
        _id: { $in: due.map((d) => d.question) },
      })
        .select('question type')
        .lean();
      const byId = new Map(questions.map((q) => [String(q._id), q]));
      const items = due
        .filter((d) => byId.has(d.question))
        .map((d) => ({
          ...d,
          preview: snippet(byId.get(d.question).question),
        }));
      res.render(VIEWS + 'private/reviewList.ejs', {
        items,
        intervals: REVIEW_INTERVAL_DAYS,
        pageName: 'Spaced Review',
      });
    }),
  );

  app.get(
    '/review/:id',
    wrap(async (req, res) => {
      const id = toObjectId(req.params.id);
      const entry = id && (await dueEntry(mongo, req.user, id));
      const question = entry && (await mongo.Ques.findById(id).lean());
      if (!question) {
        req.flash('errorFlash', 'That question is not due for review.');
        return res.redirect('/review');
      }
      res.render(VIEWS + 'private/reviewQuestion.ejs', {
        question,
        entry,
        result: null,
        pageName: 'Spaced Review',
      });
    }),
  );

  app.post(
    '/review/:id',
    wrap(async (req, res) => {
      const id = toObjectId(req.params.id);
      const entry = id && (await dueEntry(mongo, req.user, id));
      const question = entry && (await mongo.Ques.findById(id).lean());
      if (!question) {
        // also covers a replayed submit: once answered, it is no longer due
        req.flash('errorFlash', 'That question is not due for review.');
        return res.redirect('/review');
      }
      const graded = gradeAnswer(question, {
        ...req.body,
        type: question.type,
      });
      if (!graded) {
        req.flash('errorFlash', 'Please choose an answer.');
        return res.redirect('/review/' + id);
      }
      // review answers never change ratings or experience, so they cannot be farmed
      await mongo.Attempt.create({
        user: req.user._id,
        question: question._id,
        bank: 'standard',
        subject: String(question.subject[0]).toLowerCase(),
        units: question.units || [],
        correct: graded.correct,
        rated: false,
        mode: 'review',
      });
      res.render(VIEWS + 'private/reviewQuestion.ejs', {
        question,
        entry,
        result: {
          correct: graded.correct,
          correctAnswer: describeCorrect(question),
          graduated:
            graded.correct && entry.box + 1 >= REVIEW_INTERVAL_DAYS.length,
          // undefined once graduated
          nextInDays: graded.correct
            ? REVIEW_INTERVAL_DAYS[entry.box + 1]
            : REVIEW_INTERVAL_DAYS[0],
        },
        pageName: 'Spaced Review',
      });
    }),
  );
};
