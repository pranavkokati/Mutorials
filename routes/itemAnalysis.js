// Contributor-facing item analysis. Contributors see only their own questions;
// admins may pass ?id= to inspect another author. Responses contain aggregate
// counts only. See docs/ITEM-ANALYSIS.md.
const { isAdmin } = require('../utils/constants/sitesettings');
const { analyzeItem } = require('../utils/functions/itemAnalysis');
const { asString, wrap } = require('../utils/functions/http');
const { toPlainText } = require('../utils/ai/text');

const VIEWS = __dirname + '/../views/';
const QUESTION_LIMIT = 200;
const ATTEMPT_LIMIT = 100000;

const preview = (html, max = 120) => {
  const text = toPlainText(html, 400).replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

async function itemReport(mongo, authorId) {
  if (!authorId) {
    return { questions: [], truncated: false };
  }
  const questions = await mongo.Ques.find({ author: authorId })
    .sort({ _id: -1 })
    .limit(QUESTION_LIMIT)
    .select('question type choices answer rating subject stats')
    .lean();
  const attempts = await mongo.Attempt.find({
    question: { $in: questions.map((q) => q._id) },
    bank: 'standard',
    rated: true,
  })
    .sort({ createdAt: -1 })
    .limit(ATTEMPT_LIMIT)
    .select('question correct choice userRatingBefore questionRatingBefore')
    .lean();

  const byQuestion = new Map();
  for (const a of attempts) {
    const key = String(a.question);
    if (!byQuestion.has(key)) byQuestion.set(key, []);
    byQuestion.get(key).push(a);
  }
  const rows = questions.map((q) => ({
    id: String(q._id),
    subject: q.subject[0],
    type: q.type,
    rating: q.rating,
    preview: preview(q.question),
    ...analyzeItem(q, byQuestion.get(String(q._id)) || []),
  }));
  // rows needing attention first
  const severity = (r) =>
    r.flags.some((f) => f.type === 'possible-key-error')
      ? 0
      : r.calibration === 'harder-than-rated' ||
          r.calibration === 'easier-than-rated'
        ? 1
        : r.flags.length > 0
          ? 2
          : 3;
  rows.sort((a, b) => severity(a) - severity(b) || b.attempts - a.attempts);
  return {
    questions: rows,
    truncated:
      questions.length >= QUESTION_LIMIT || attempts.length >= ATTEMPT_LIMIT,
  };
}

module.exports = (app, mongo) => {
  // the /contributor* guard in routes/contributors.js already requires a contributor
  const authorFor = (req) =>
    isAdmin(req.user) && req.query.id
      ? asString(req.query.id)
      : req.user.contributor;

  app.get(
    '/contributors/items/data',
    wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await itemReport(mongo, authorFor(req)));
    }),
  );

  app.get(
    '/contributors/items',
    wrap(async (req, res) => {
      res.render(VIEWS + 'contributors/itemAnalysis.ejs', {
        report: await itemReport(mongo, authorFor(req)),
        pageName: 'Item Analysis',
      });
    }),
  );
};
