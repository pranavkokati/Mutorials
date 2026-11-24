process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, signedInAgent } = require('./helpers');
const {
  sparkline,
  ratingCards,
  levelProgress,
  niceDomain,
  spreadLabels,
  ratingChart,
} = require('../utils/functions/dashboard');
const { subjectUnitDictionary } = require('../utils/constants/subjects');

// ------------------------------------------------------------ dashboard helpers

test('sparkline needs two finite values and stays inside its box', () => {
  assert.equal(sparkline([]), null);
  assert.equal(sparkline([1500]), null);
  assert.equal(sparkline(['x', null, 1500]), null);

  const s = sparkline([1500, 1520, 1480, 1600], {
    width: 100,
    height: 40,
    pad: 4,
  });
  const coords = s.points.split(' ').map((p) => p.split(',').map(Number));
  assert.equal(coords.length, 4);
  for (const [x, y] of coords) {
    assert.ok(x >= 4 && x <= 96, `x ${x} inside padding`);
    assert.ok(y >= 4 && y <= 36, `y ${y} inside padding`);
  }
  // higher rating is drawn higher (smaller y)
  assert.ok(coords[3][1] < coords[0][1]);
  assert.equal(s.change, 100);
});

test('sparkline draws a flat history mid-height and accepts stored strings', () => {
  const flat = sparkline([1500, 1500, 1500], { height: 36 });
  assert.ok(flat.points.split(' ').every((p) => p.endsWith(',18')));
  assert.equal(sparkline(['1400', '1450']).change, 50);
});

test('sparkline keeps only the most recent points', () => {
  const long = Array.from({ length: 100 }, (_, i) => 1000 + i);
  const s = sparkline(long);
  assert.equal(s.samples, 30);
  assert.equal(s.change, 29);
});

test('rating cards mark unrated subjects and never invent a trend for them', () => {
  const cards = ratingCards({
    rating: { physics: 2100, chemistry: -1, biology: 0 },
    stats: {
      ratingTracker: { physics: [2000, 2050, 2100], chemistry: [1, 2] },
    },
  });
  const by = Object.fromEntries(cards.map((c) => [c.key, c]));
  assert.equal(by.physics.rated, true);
  assert.equal(by.physics.rating, 2100);
  assert.ok(by.physics.trend);
  assert.equal(by.chemistry.rated, false);
  assert.equal(by.chemistry.trend, null);
  assert.equal(by.biology.rated, false);
  assert.equal(by.usabo.rated, false);
  assert.equal(cards.length, 5);
  // missing user data must not throw
  assert.equal(ratingCards(undefined).length, 5);
});

test('level progress is clamped to 0-100', () => {
  assert.equal(levelProgress({ remainder: 50, totalToNext: 200 }), 25);
  assert.equal(levelProgress({ remainder: 999, totalToNext: 200 }), 100);
  assert.equal(levelProgress({ remainder: -5, totalToNext: 200 }), 0);
  assert.equal(levelProgress(null), 0);
});

// ------------------------------------------------------------ app shell

let ctx;
before(async () => {
  ctx = await start();
});
after(stop);

const APP_PAGES = [
  '/homepage',
  '/train',
  '/train/chooseSubject',
  '/coach',
  '/review',
  '/search',
  '/search?text=force',
  '/leaderboard',
];

test('migrated pages render in the app shell with absolute navigation links', async () => {
  const { agent } = await signedInAgent(ctx.app, {
    username: 'ui1@example.com',
    ign: 'uiuser',
  });
  for (const path of APP_PAGES) {
    const res = await agent.get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.text, /<main id="content"/, `${path} uses the app layout`);
    assert.match(res.text, /href="\/homepage"/, path);
    assert.match(res.text, /href="\/coach"/, path);
    // no relative nav links that would break from nested paths
    assert.doesNotMatch(
      res.text,
      /<a[^>]+href="(train|stats|leaderboard)\b/,
      path,
    );
  }
});

test('the current section is marked in the navigation', async () => {
  const { agent } = await signedInAgent(ctx.app, {
    username: 'ui2@example.com',
    ign: 'uinav',
  });
  const res = await agent.get('/coach');
  assert.match(res.text, /href="\/coach"\s+aria-current="page"/);
  assert.doesNotMatch(res.text, /href="\/review"\s+aria-current="page"/);
});

test('app pages stay behind login', async () => {
  const { request } = require('./helpers');
  for (const path of ['/homepage', '/coach', '/review', '/search']) {
    const res = await request(ctx.app).get(path);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.location, '/', path);
  }
});

test('the admin link only appears for admins', async () => {
  const { agent } = await signedInAgent(ctx.app, {
    username: 'ui3@example.com',
    ign: 'uiplain',
  });
  const res = await agent.get('/homepage');
  assert.doesNotMatch(res.text, /adminHomepage/);
});

test('a new learner with no history gets a usable homepage', async () => {
  const { agent } = await signedInAgent(ctx.app, {
    username: 'ui4@example.com',
    ign: 'uinew',
  });
  const res = await agent.get('/homepage');
  assert.match(res.text, /Welcome back, uinew/);
  assert.match(res.text, /Nothing is due for review/);
  assert.match(res.text, /Nothing to plot yet/);
});

test('keyword search results show readable question text', async () => {
  const { agent } = await signedInAgent(ctx.app, {
    username: 'ui5@example.com',
    ign: 'uisearch',
  });
  await ctx.mongo.Ques.create({
    question: '<p>A pendulum swings with <b>small</b> amplitude.</p>',
    choices: ['a', 'b'],
    tags: [],
    rating: 1500,
    answer: ['1'],
    answer_ex: 'x',
    author: 'MU-TEST',
    type: 'mc',
    ext_source: 'Original',
    subject: ['Physics'],
    units: ['Physics - Oscillations'],
  });
  const res = await agent.get('/search?text=pendulum');
  assert.match(res.text, /A pendulum swings with small amplitude\./);
  assert.doesNotMatch(res.text, /<b>small<\/b>/);
});

test('migrated pages load MathJax, with its config defined before the loader', async () => {
  const { agent } = await signedInAgent(ctx.app, {
    username: 'ui5@example.com',
    ign: 'uimath',
  });
  const res = await agent.get('/homepage');
  const config = res.text.indexOf('window.MathJax');
  const loader = res.text.indexOf('mathjax@3/es5/tex-mml-chtml.js');
  assert.ok(config !== -1 && loader !== -1, 'MathJax is on the page');
  assert.ok(config < loader, 'config must be defined before the loader runs');
  assert.match(res.text, /inlineMath: \[\['\$', '\$'\]/);
});

// ------------------------------------------------------------ chart helpers

test('niceDomain returns round bounds that contain the data with a few gridlines', () => {
  for (const [min, max] of [
    [1180, 1263],
    [900, 3300],
    [1500, 1500],
    [0, 7],
  ]) {
    const d = niceDomain(min, max);
    assert.ok(d.lo <= min && d.hi >= max, `${min}-${max} is contained`);
    assert.ok(d.hi > d.lo, 'never a zero-height axis');
    assert.equal(d.lo % d.step, 0);
    assert.ok(
      d.ticks.length >= 2 && d.ticks.length <= 7,
      `${d.ticks.length} ticks`,
    );
    assert.equal(d.ticks[0], d.lo);
    assert.equal(d.ticks[d.ticks.length - 1], d.hi);
  }
});

test('spreadLabels keeps labels apart and in range without reordering them', () => {
  const out = spreadLabels([50, 51, 52, 10], 9, 2, 98);
  assert.equal(out.length, 4);
  const sorted = [...out].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i] - sorted[i - 1] >= 9 - 1e-9, 'gap respected');
  }
  assert.ok(out.every((v) => v >= 2 && v <= 98));
  // the label that wanted to be highest on the page is still the highest
  assert.ok(out[3] < out[0] && out[0] < out[1] && out[1] < out[2]);
  // labels that already fit are left where they are
  assert.deepEqual(spreadLabels([10, 40, 80], 9), [10, 40, 80]);
  assert.deepEqual(spreadLabels([]), []);
});

test('ratingChart is empty without history and right-aligns series that have it', () => {
  assert.equal(
    ratingChart({ rating: {}, stats: { ratingTracker: {} } }).empty,
    true,
  );
  assert.equal(ratingChart(null).empty, true);

  const chart = ratingChart({
    rating: { physics: 1300, chemistry: 1210, biology: 1000 },
    stats: {
      ratingTracker: {
        physics: [1200, 1220, 1250, 1300],
        chemistry: [1200, 1210],
        biology: [1000],
      },
    },
  });
  assert.equal(chart.empty, false);
  assert.equal(chart.series.length, 2);
  // one answer is not a line: it is listed, not drawn
  assert.deepEqual(
    chart.unplotted.map((u) => u.key),
    ['biology'],
  );
  for (const s of chart.series) {
    assert.equal(s.endX, 100, 'the latest answer lines up on the right edge');
    assert.ok(s.endY >= 0 && s.endY <= 100);
    assert.ok(s.labelY >= 2 && s.labelY <= 98);
  }
  const gap = Math.abs(chart.series[0].labelY - chart.series[1].labelY);
  assert.ok(gap >= 9 - 1e-9, 'end labels never overlap');
  const physics = chart.series.find((s) => s.key === 'physics');
  assert.equal(physics.change, 100);
  assert.equal(physics.samples, 4);
  // the shorter history starts part-way along
  const chem = chart.series.find((s) => s.key === 'chemistry');
  assert.ok(Number(chem.points.split(' ')[0].split(',')[0]) > 0);
});

// ------------------------------------------------------------ practice flow

const unit = () => 'Physics - ' + subjectUnitDictionary.Physics[0];
const question = (overrides = {}) => ({
  question: '<p>What is <em>net force</em> divided by mass?</p>',
  choices: ['Acceleration <b>x</b>', 'Momentum', 'Energy'],
  tags: ['dynamics'],
  rating: 1200,
  answer: ['1'],
  answer_ex: "<p>Newton's second law.</p>",
  author: 'MU-AUTHOR',
  type: 'mc',
  ext_source: 'Original',
  subject: ['Physics'],
  units: [unit()],
  stats: { pass: 3, fail: 1 },
  ...overrides,
});

async function physicsLearner(username, ign) {
  const { agent, user } = await signedInAgent(ctx.app, { username, ign });
  await ctx.mongo.User.updateOne(
    { username: user.username },
    { $set: { 'rating.physics': 1200 } },
  );
  return agent;
}

test('the question page is a real form: required choices, escaped option text, intact hidden fields', async () => {
  await ctx.mongo.Ques.create(question());
  const agent = await physicsLearner('flow1@example.com', 'flowone');
  const res = await agent
    .get('/train/Physics/displayQuestion')
    .query({ units: unit() });
  assert.equal(res.status, 200);
  assert.match(res.text, /action="\/train\/checkAnswer"/);
  assert.match(
    res.text,
    /<input type="radio" name="answerChoice" value="1" required>/,
  );
  assert.match(res.text, /<input type="radio" name="answerChoice" value="3" >/);
  // author HTML is trusted (it carries the maths), option text is not
  assert.match(res.text, /<em>net force<\/em>/);
  assert.match(res.text, /Acceleration &lt;b&gt;x&lt;\/b&gt;/);
  for (const name of ['id', 'type', 'subject', 'units', 'redirect']) {
    assert.match(
      res.text,
      new RegExp('<input type="hidden" name="' + name + '"'),
    );
  }
  assert.match(res.text, /action="\/train\/skipQuestion"/);
  assert.match(res.text, /should get this right about/);
});

test('select-all questions render checkboxes and a free-response question a text box', async () => {
  await ctx.mongo.Ques.deleteMany({});
  await ctx.mongo.Ques.create(question({ type: 'sa', answer: ['1', '2'] }));
  const agent = await physicsLearner('flow2@example.com', 'flowtwo');
  let res = await agent
    .get('/train/Physics/displayQuestion')
    .query({ units: unit() });
  assert.match(res.text, /type="checkbox" name="saChoice"/);
  assert.match(res.text, /Select every answer that applies/);

  await ctx.mongo.Ques.deleteMany({});
  await ctx.mongo.Ques.create(
    question({ type: 'fr', choices: [], answer: ['9.8'] }),
  );
  res = await agent
    .get('/train/Physics/displayQuestion')
    .query({ units: unit() });
  assert.match(res.text, /name="freeAnswer"[^>]*required/);
});

test('the answer page marks the right and wrong choices in words, not only colour', async () => {
  await ctx.mongo.Ques.deleteMany({});
  const q = await ctx.mongo.Ques.create(question());
  const agent = await physicsLearner('flow3@example.com', 'flowthree');
  const wrong = await agent
    .post('/train/checkAnswer')
    .type('form')
    .send({
      id: String(q._id),
      type: 'mc',
      answerChoice: '2',
      units: unit(),
      subject: 'Physics',
    });
  assert.equal(wrong.status, 200);
  assert.match(wrong.text, />Not quite</);
  assert.match(wrong.text, /Your answer</);
  assert.match(wrong.text, /Correct answer</);
  assert.match(wrong.text, /Newton&#39;s second law|Newton's second law/);
  assert.match(wrong.text, /Solved by/);

  const right = await agent
    .post('/train/checkAnswer')
    .type('form')
    .send({
      id: String(q._id),
      type: 'mc',
      answerChoice: '1',
      units: unit(),
      subject: 'Physics',
    });
  assert.match(right.text, />Correct</);
  assert.match(right.text, /Your answer, correct/);
});

test('unit picker, proficiency and daily pages render in the app shell', async () => {
  await ctx.mongo.Ques.deleteMany({});
  await ctx.mongo.Ques.create(question());
  const { agent } = await signedInAgent(ctx.app, {
    username: 'flow4@example.com',
    ign: 'flowfour',
  });
  let res = await agent.get('/train/Physics/proficiency');
  assert.equal(res.status, 200);
  assert.match(res.text, /action="\/private\/initialRating"/);
  assert.match(res.text, /name="level" value="600"/);

  await ctx.mongo.User.updateOne(
    { username: 'flow4@example.com' },
    { $set: { 'rating.physics': 1200 } },
  );
  res = await agent.get('/train/Physics/chooseUnits');
  assert.equal(res.status, 200);
  assert.match(res.text, /name="unitChoice"/);
  assert.match(res.text, /action="\/selQ"/);

  res = await agent.get('/train/daily');
  assert.equal(res.status, 200);
  assert.match(res.text, /Daily problem/);
  for (const html of [res.text]) assert.match(html, /class="app-surface"/);
});
