process.env.NODE_ENV = 'test';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, stop, signedInAgent } = require('./helpers');
const {
  sparkline,
  ratingCards,
  levelProgress,
} = require('../utils/functions/dashboard');

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
  assert.match(res.text, /All caught up/);
  assert.match(res.text, /Not rated yet/);
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
