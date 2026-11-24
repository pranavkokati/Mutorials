process.env.NODE_ENV = 'test';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, signedInAgent } = require('./helpers');
const { subjectUnitDictionary } = require('../utils/constants/subjects');
const {
  unitPerformance,
  recommend,
  reviewState,
  dueReviews,
  REVIEW_INTERVAL_DAYS,
} = require('../utils/functions/coach');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 23);
const at = (daysAgo) => new Date(NOW - daysAgo * DAY);

// ------------------------------------------------------------ unit performance

function attempts(
  unit,
  n,
  hitRate,
  { userRating = 2000, qRating = 2000 } = {},
) {
  // deterministic pattern with the requested hit rate
  const out = [];
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    acc += hitRate;
    const correct = acc >= 1;
    if (correct) acc -= 1;
    out.push({
      subject: 'physics',
      units: [unit],
      correct,
      rated: true,
      userRatingBefore: userRating,
      questionRatingBefore: qRating,
      createdAt: at(1 + (i % 10)),
    });
  }
  return out;
}

test('performance is judged against the rating-implied expectation, not raw accuracy', () => {
  // equal ratings imply 50 %; doing 20 % is a weak spot even though 20 % > 0
  const [weak] = unitPerformance(attempts('Physics - Waves', 40, 0.2), NOW);
  assert.equal(weak.status, 'weak');
  assert.ok(weak.residual < -0.08);

  // a user rated far above the question is expected to win; 50 % is then a miss
  const [easy] = unitPerformance(
    attempts('Physics - Optics', 40, 0.5, { userRating: 3500, qRating: 1500 }),
    NOW,
  );
  assert.equal(easy.status, 'weak');
  assert.ok(easy.expectedAccuracy > 0.8);
});

test('on-par performance is on-track and strong performance is flagged', () => {
  const [par] = unitPerformance(attempts('Physics - A', 40, 0.5), NOW);
  assert.equal(par.status, 'on-track');
  const [strong] = unitPerformance(attempts('Physics - B', 40, 0.85), NOW);
  assert.equal(strong.status, 'strong');
});

test('few attempts are never classified (shrinkage and minimum evidence)', () => {
  const [few] = unitPerformance(attempts('Physics - C', 3, 0), NOW);
  assert.equal(few.status, 'insufficient');
  // three straight misses must not look as bad as forty
  const [many] = unitPerformance(attempts('Physics - C', 40, 0), NOW);
  assert.ok(Math.abs(few.residual) < Math.abs(many.residual));
});

test('recent attempts outweigh old ones', () => {
  const old = attempts('Physics - D', 30, 0).map((a) => ({
    ...a,
    createdAt: at(300),
  }));
  const recent = attempts('Physics - D', 30, 1).map((a) => ({
    ...a,
    createdAt: at(2),
  }));
  const [mixed] = unitPerformance([...old, ...recent], NOW);
  assert.ok(mixed.residual > 0, 'recent successes dominate ancient misses');
});

test('unrated and malformed attempts are ignored', () => {
  const noise = [
    {
      subject: 'physics',
      units: ['Physics - E'],
      correct: false,
      rated: false,
    },
    {
      subject: 'physics',
      units: ['Physics - E'],
      correct: false,
      rated: true,
      userRatingBefore: -1,
      questionRatingBefore: 1000,
      createdAt: at(1),
    },
    {
      subject: 'physics',
      units: ['Physics - E'],
      correct: false,
      rated: true,
      createdAt: at(1),
    },
  ];
  assert.deepEqual(unitPerformance(noise, NOW), []);
});

test('a question tagged with several units credits each of them once', () => {
  const rows = unitPerformance(
    [
      {
        subject: 'physics',
        units: ['Physics - F', 'Physics - G', 'Physics - F'],
        correct: true,
        rated: true,
        userRatingBefore: 2000,
        questionRatingBefore: 2000,
        createdAt: at(1),
      },
    ],
    NOW,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.attempts === 1));
});

test('recommend puts the weakest units first and fills with unexplored units', () => {
  const perf = [
    { unit: 'P - a', status: 'weak', residual: -0.1 },
    { unit: 'P - b', status: 'weak', residual: -0.25 },
    { unit: 'P - c', status: 'strong', residual: 0.2 },
  ];
  const picks = recommend(perf, ['P - a', 'P - b', 'P - c', 'P - d', 'P - e']);
  assert.deepEqual(
    picks.map((p) => [p.unit, p.reason]),
    [
      ['P - b', 'weak'],
      ['P - a', 'weak'],
      ['P - d', 'unexplored'],
    ],
  );
});

// ------------------------------------------------------------ spaced review

const a = (correct, daysAgo) => ({ correct, createdAt: at(daysAgo) });

test('a question is only queued after a miss and climbs boxes on correct answers', () => {
  assert.equal(reviewState([a(true, 5)]), null);
  assert.equal(reviewState([a(true, 9), a(true, 5)]), null);

  const missed = reviewState([a(false, 2)]);
  assert.equal(missed.box, 0);
  assert.equal(missed.dueAt, at(2).getTime() + REVIEW_INTERVAL_DAYS[0] * DAY);

  assert.equal(reviewState([a(false, 9), a(true, 5)]).box, 1);
  assert.equal(reviewState([a(false, 9), a(true, 8), a(false, 5)]).box, 0);
});

test('five consecutive correct reviews graduate a question', () => {
  const run = [
    a(false, 60),
    a(true, 50),
    a(true, 40),
    a(true, 30),
    a(true, 20),
  ];
  assert.equal(reviewState(run).graduated, false);
  const done = reviewState([...run, a(true, 5)]);
  assert.equal(done.graduated, true);
  assert.equal(done.dueAt, null);
});

test('dueReviews lists only due, ungraduated questions, most overdue first', () => {
  const rows = [
    {
      question: 'q-overdue',
      bank: 'standard',
      subject: 'physics',
      units: [],
      ...a(false, 10),
    },
    {
      question: 'q-fresh',
      bank: 'standard',
      subject: 'physics',
      units: [],
      ...a(false, 0.2),
    },
    {
      question: 'q-slightly',
      bank: 'standard',
      subject: 'physics',
      units: [],
      ...a(false, 1.5),
    },
    {
      question: 'q-never-missed',
      bank: 'standard',
      subject: 'physics',
      units: [],
      ...a(true, 10),
    },
  ];
  const due = dueReviews(rows, NOW);
  assert.deepEqual(
    due.map((d) => d.question),
    ['q-overdue', 'q-slightly'],
  );
  assert.ok(due[0].overdueDays > due[1].overdueDays);
});

// ------------------------------------------------------------ routes

let ctx;
let seq = 0;
before(async () => {
  ctx = await start();
});
after(stop);
beforeEach(async () => {
  await Promise.all(
    ['User', 'Ques', 'Attempt'].map((m) => ctx.mongo[m].deleteMany({})),
  );
});

const unitName = () => 'Physics - ' + subjectUnitDictionary.Physics[0];

async function newUser(rating = 2000) {
  seq += 1;
  const session = await signedInAgent(ctx.app, {
    username: `coach${seq}@example.com`,
    ign: `coach${seq}`,
  });
  await ctx.mongo.User.updateOne(
    { username: session.user.username },
    { $set: { 'rating.physics': rating } },
  );
  const doc = await ctx.mongo.User.findOne({
    username: session.user.username,
  }).lean();
  return { agent: session.agent, doc };
}

function question(overrides = {}) {
  return ctx.mongo.Ques.create({
    question: 'What is 2+2?',
    choices: ['3', '4', '5'],
    tags: [],
    rating: 2000,
    answer: ['2'],
    answer_ex: 'Arithmetic.',
    author: 'MU-AUTHOR',
    type: 'mc',
    ext_source: 'Original',
    subject: ['Physics'],
    units: [unitName()],
    stats: { pass: 0, fail: 0 },
    ...overrides,
  });
}

const logAttempt = (doc, q, correct, daysAgo, extra = {}) =>
  ctx.mongo.Attempt.create({
    user: doc._id,
    question: q._id,
    bank: 'standard',
    subject: 'physics',
    units: q.units,
    correct,
    rated: true,
    userRatingBefore: 2000,
    questionRatingBefore: 2000,
    // route tests run on the real clock
    createdAt: new Date(Date.now() - daysAgo * DAY),
    ...extra,
  });

test('coach pages require authentication', async () => {
  const supertest = require('supertest');
  for (const path of ['/coach', '/coach/data', '/review']) {
    const res = await supertest(ctx.app).get(path);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.location, '/');
  }
});

test('coach data flags a weak unit and links to practising it', async () => {
  const { agent, doc } = await newUser();
  const q = await question();
  for (let i = 0; i < 20; i += 1) {
    await logAttempt(doc, q, i % 5 === 0, 1 + (i % 7));
  }
  const res = await agent.get('/coach/data');
  assert.equal(res.status, 200);
  const unit = res.body.subjects.Physics.units[0];
  assert.equal(unit.unit, unitName());
  assert.equal(unit.status, 'weak');
  assert.equal(res.body.subjects.Physics.recommendations[0].reason, 'weak');
  assert.ok(
    res.body.subjects.Physics.recommendations[0].href.startsWith(
      '/train/Physics/displayQuestion?units=',
    ),
  );
  // subjects without a rating are not coached
  assert.equal(res.body.subjects.Chemistry, undefined);
  const page = await agent.get('/coach');
  assert.equal(page.status, 200);
  assert.match(page.text, /Weak spot/);
});

test("coach does not leak another learner's attempts", async () => {
  const mine = await newUser();
  const theirs = await newUser();
  const q = await question();
  for (let i = 0; i < 12; i += 1) {
    await logAttempt(theirs.doc, q, false, 1 + i);
  }
  const res = await mine.agent.get('/coach/data');
  assert.equal(res.body.attemptsAnalysed, 0);
  assert.deepEqual(res.body.subjects.Physics.units, []);
});

test('review: a missed question is due after its interval, and a correct answer reschedules it', async () => {
  const { agent, doc } = await newUser();
  const q = await question();
  await logAttempt(doc, q, false, 2);

  const list = await agent.get('/review');
  assert.equal(list.status, 200);
  assert.match(list.text, /What is 2\+2\?/);

  const form = await agent.get('/review/' + q._id);
  assert.equal(form.status, 200);
  assert.match(form.text, /name="answerChoice"/);

  const before = await ctx.mongo.User.findOne({ _id: doc._id }).lean();
  const res = await agent
    .post('/review/' + q._id)
    .type('form')
    .send({ answerChoice: '2' });
  assert.equal(res.status, 200);
  assert.match(res.text, /Correct\./);
  assert.match(res.text, /3 days/);

  const logged = await ctx.mongo.Attempt.find({
    user: doc._id,
    mode: 'review',
  }).lean();
  assert.equal(logged.length, 1);
  assert.equal(logged[0].rated, false);
  assert.equal(logged[0].correct, true);

  // no effect on rating or experience: review answers cannot be farmed
  const after = await ctx.mongo.User.findOne({ _id: doc._id }).lean();
  assert.equal(after.rating.physics, before.rating.physics);
  assert.deepEqual(after.stats, before.stats);
  const qAfter = await ctx.mongo.Ques.findById(q._id).lean();
  assert.equal(qAfter.rating, 2000);
  assert.equal(qAfter.stats.pass, 0);

  // replaying the submit is a no-op: the question is no longer due
  const replay = await agent
    .post('/review/' + q._id)
    .type('form')
    .send({ answerChoice: '2' });
  assert.equal(replay.status, 302);
  assert.equal(
    await ctx.mongo.Attempt.countDocuments({ user: doc._id, mode: 'review' }),
    1,
  );
});

test('review: a wrong answer resets to the first interval; not-due and foreign questions are refused', async () => {
  const { agent, doc } = await newUser();
  const due = await question();
  const fresh = await question();
  await logAttempt(doc, due, false, 5);
  await logAttempt(doc, fresh, false, 0.1);

  const miss = await agent
    .post('/review/' + due._id)
    .type('form')
    .send({ answerChoice: '1' });
  assert.match(miss.text, /Not yet\./);
  assert.match(miss.text, /1 day\./);

  const notDue = await agent.get('/review/' + fresh._id);
  assert.equal(notDue.status, 302);
  assert.equal(notDue.headers.location, '/review');

  const other = await newUser();
  const theirs = await question();
  await logAttempt(other.doc, theirs, false, 5);
  const foreign = await agent.get('/review/' + theirs._id);
  assert.equal(foreign.status, 302);
  const junk = await agent.get('/review/not-an-id');
  assert.equal(junk.status, 302);
});

test('review: an empty submission is not graded or logged', async () => {
  const { agent, doc } = await newUser();
  const q = await question();
  await logAttempt(doc, q, false, 3);
  const res = await agent
    .post('/review/' + q._id)
    .type('form')
    .send({});
  assert.equal(res.status, 302);
  assert.equal(
    await ctx.mongo.Attempt.countDocuments({ user: doc._id, mode: 'review' }),
    0,
  );
});
