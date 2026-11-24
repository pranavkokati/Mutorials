// Study coach (weak-spot analysis) and spaced-review queue.
// Both are derived from the append-only Attempt log; see docs/COACH.md.
const {
  dueReviews,
  REVIEW_INTERVAL_DAYS,
} = require('../utils/functions/coach');
const {
  loadAttempts,
  buildCoach,
  dueEntry,
} = require('../utils/functions/coachData');
const { appLayout } = require('../utils/middleware/appLayout');
const { gradeAnswer } = require('../utils/functions/answers');
const { toObjectId } = require('../utils/functions/ids');
const { wrap } = require('../utils/functions/http');
const { toPlainText, describeCorrect } = require('../utils/ai/text');

const VIEWS = __dirname + '/../views/';
const REVIEW_PAGE = 25;

const snippet = (html, max = 180) => {
  const text = toPlainText(html, 600).replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

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
    appLayout,
    wrap(async (req, res) => {
      res.render(VIEWS + 'private/coach.ejs', {
        coach: await buildCoach(mongo, req.user),
        pageName: 'Study Coach',
      });
    }),
  );

  app.get(
    '/review',
    appLayout,
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
    appLayout,
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
    appLayout,
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
