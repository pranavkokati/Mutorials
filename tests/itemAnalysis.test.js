process.env.NODE_ENV = 'test';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { start, stop, signedInAgent } = require('./helpers');
const { subjectUnitDictionary } = require('../utils/constants/subjects');
const { analyzeItem, ITEM } = require('../utils/functions/itemAnalysis');
const { normalizeChoice } = require('../utils/functions/answers');

const mc = { type: 'mc', choices: ['a', 'b', 'c', 'd'], answer: ['2'] };

// n attempts by learners rated `user` on a question rated `q`
function run(n, { user = 2000, q = 2000, picks, correctRate } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const pick = picks ? picks[i % picks.length] : '2';
    out.push({
      correct: correctRate === undefined ? pick === '2' : i / n < correctRate,
      choice: [pick],
      userRatingBefore: user,
      questionRatingBefore: q,
    });
  }
  return out;
}

test('calibration needs enough answers and compares with the rating-implied rate', () => {
  assert.equal(
    analyzeItem(mc, run(10, { correctRate: 0 })).calibration,
    'insufficient',
  );
  // equal ratings imply 50 %; 10 % observed is far harder than rated
  assert.equal(
    analyzeItem(mc, run(60, { correctRate: 0.1 })).calibration,
    'harder-than-rated',
  );
  assert.equal(
    analyzeItem(mc, run(60, { correctRate: 0.9 })).calibration,
    'easier-than-rated',
  );
  assert.equal(
    analyzeItem(mc, run(60, { correctRate: 0.5 })).calibration,
    'ok',
  );
});

test('attempts without usable ratings are ignored', () => {
  const junk = [
    {
      correct: true,
      choice: ['2'],
      userRatingBefore: -1,
      questionRatingBefore: 1000,
    },
    { correct: true, choice: ['2'] },
  ];
  assert.equal(analyzeItem(mc, junk).attempts, 0);
});

test('option shares are hidden below the minimum cell and shown above it', () => {
  const few = analyzeItem(
    mc,
    run(ITEM.minOptionCell - 1, { picks: ['1', '2'] }),
  );
  assert.equal(few.options, null);
  const many = analyzeItem(mc, run(20, { picks: ['1', '2'] }));
  assert.equal(many.options.length, 4);
  assert.equal(many.options[1].correct, true);
  assert.equal(many.options[0].share, 0.5);
  assert.equal(many.options[2].count, 0);
});

test('a distractor nobody picks is flagged only with enough answers', () => {
  const small = analyzeItem(mc, run(20, { picks: ['1', '2', '3'] }));
  assert.equal(
    small.flags.filter((f) => f.type === 'unused-distractor').length,
    0,
  );
  const big = analyzeItem(mc, run(60, { picks: ['1', '2', '3'] }));
  const dead = big.flags.filter((f) => f.type === 'unused-distractor');
  assert.deepEqual(
    dead.map((f) => f.option),
    [4],
  );
});

test('possible key error: strong learners prefer a wrong option over the keyed one', () => {
  // learners rated far above the question; most choose option 3, key says 2
  const strong = run(30, { user: 3500, q: 1500, picks: ['3', '3', '3', '2'] });
  const result = analyzeItem(mc, strong);
  const flag = result.flags.find((f) => f.type === 'possible-key-error');
  assert.ok(flag);
  assert.equal(flag.option, 3);
  assert.ok(flag.wrongShare > flag.keyedShare);

  // a healthy question with the same learners is not flagged
  const healthy = analyzeItem(
    mc,
    run(30, { user: 3500, q: 1500, picks: ['2', '2', '2', '3'] }),
  );
  assert.equal(
    healthy.flags.some((f) => f.type === 'possible-key-error'),
    false,
  );

  // weak learners picking wrong options is normal, not a key error
  const weak = analyzeItem(
    mc,
    run(30, { user: 1000, q: 3000, picks: ['3', '3', '3', '2'] }),
  );
  assert.equal(
    weak.flags.some((f) => f.type === 'possible-key-error'),
    false,
  );
});

test('select-all and free-response questions get calibration but no option analysis', () => {
  const sa = analyzeItem(
    { type: 'sa', choices: ['a', 'b'], answer: ['1', '2'] },
    run(40),
  );
  assert.equal(sa.options, null);
  assert.deepEqual(sa.flags, []);
  const fr = analyzeItem({ type: 'fr', answer: ['x'] }, run(40));
  assert.equal(fr.options, null);
});

test('normalizeChoice stores option numbers only', () => {
  assert.deepEqual(normalizeChoice(mc, '2'), ['2']);
  assert.deepEqual(normalizeChoice({ ...mc, type: 'sa' }, ['3', '1', '3']), [
    '1',
    '3',
  ]);
  assert.deepEqual(normalizeChoice(mc, '9'), []);
  assert.deepEqual(normalizeChoice(mc, '<script>'), []);
  assert.deepEqual(
    normalizeChoice({ type: 'fr', choices: [] }, 'my secret answer'),
    [],
  );
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

const unit = () => 'Physics - ' + subjectUnitDictionary.Physics[0];

async function newUser(extra = {}) {
  seq += 1;
  const s = await signedInAgent(ctx.app, {
    username: `item${seq}@example.com`,
    ign: `item${seq}`,
  });
  if (Object.keys(extra).length > 0) {
    await ctx.mongo.User.updateOne(
      { username: s.user.username },
      { $set: extra },
    );
  }
  const doc = await ctx.mongo.User.findOne({
    username: s.user.username,
  }).lean();
  return { agent: s.agent, doc };
}

const question = (author, overrides = {}) =>
  ctx.mongo.Ques.create({
    question: '<p>Pick the right option.</p>',
    choices: ['a', 'b', 'c', 'd'],
    tags: [],
    rating: 2000,
    answer: ['2'],
    answer_ex: 'b.',
    author,
    type: 'mc',
    ext_source: 'Original',
    subject: ['Physics'],
    units: [unit()],
    stats: { pass: 0, fail: 0 },
    ...overrides,
  });

const attempt = (user, q, choice, correct) =>
  ctx.mongo.Attempt.create({
    user: user._id,
    question: q._id,
    bank: 'standard',
    subject: 'physics',
    units: q.units,
    correct,
    choice: [choice],
    rated: true,
    userRatingBefore: 3500,
    questionRatingBefore: 1500,
  });

test('item analysis is limited to contributors and to their own questions', async () => {
  const anon = await supertest(ctx.app).get('/contributors/items/data');
  assert.equal(anon.status, 302);

  const plain = await newUser();
  const denied = await plain.agent.get('/contributors/items/data');
  assert.equal(denied.status, 302);

  const author = await newUser({ contributor: 'MU-ME' });
  const mine = await question('MU-ME');
  const theirs = await question('MU-OTHER');
  const learner = await newUser();
  for (let i = 0; i < 12; i += 1) {
    await attempt(learner.doc, mine, '3', false);
    await attempt(learner.doc, theirs, '3', false);
  }
  const res = await author.agent.get('/contributors/items/data');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.questions.map((q) => q.id),
    [String(mine._id)],
  );
  assert.equal(res.body.questions[0].attempts, 12);
  // someone else's author id is ignored for non-admins
  const probe = await author.agent
    .get('/contributors/items/data')
    .query({ id: 'MU-OTHER' });
  assert.deepEqual(
    probe.body.questions.map((q) => q.id),
    [String(mine._id)],
  );
});

test('item analysis reports a suspect key without exposing any learner identity', async () => {
  const author = await newUser({ contributor: 'MU-ME' });
  const q = await question('MU-ME');
  const learner = await newUser();
  for (let i = 0; i < 12; i += 1) {
    await attempt(learner.doc, q, '3', false);
  }
  const res = await author.agent.get('/contributors/items/data');
  const row = res.body.questions[0];
  assert.ok(
    row.flags.some((f) => f.type === 'possible-key-error' && f.option === 3),
  );
  const raw = JSON.stringify(res.body);
  assert.doesNotMatch(raw, new RegExp(String(learner.doc._id)));
  assert.doesNotMatch(raw, /item\d+@example\.com/);
  const page = await author.agent.get('/contributors/items');
  assert.equal(page.status, 200);
  assert.match(page.text, /Check the answer key/);
});

test('answering a question through the trainer records the chosen option', async () => {
  const { agent, doc } = await newUser();
  await ctx.mongo.User.updateOne(
    { _id: doc._id },
    { $set: { 'rating.physics': 1500 } },
  );
  const q = await question('MU-ME', { rating: 1500 });
  await agent.get('/train/Physics/displayQuestion').query({ units: unit() });
  await agent
    .post('/train/checkAnswer')
    .type('form')
    .send({ id: String(q._id), type: 'mc', answerChoice: '3', units: unit() });
  const logged = await ctx.mongo.Attempt.findOne({ user: doc._id }).lean();
  assert.deepEqual(logged.choice, ['3']);
  assert.equal(logged.correct, false);
});
