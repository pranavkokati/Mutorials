#!/usr/bin/env node
/**
 * Local demo: boots Mutorials against a throwaway in-memory MongoDB seeded with
 * demo accounts, generated questions and answer history, so every page (trainer,
 * study coach, spaced review, search, item analysis) has something to show.
 *
 *   npm run demo            (then open http://localhost:3000)
 *   npm run demo -- --ai    also enable the on-server embedding model (downloads
 *                           about 23 MB on first use)
 *
 * Nothing is persisted: stop the process and the data is gone. The questions are
 * generated placeholders for looking at the interface, not real Science
 * Olympiad content.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'demo-secret';
process.env.AI_ENABLED = process.argv.includes('--ai') ? '1' : '0';
delete process.env.PORT;

const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');

const DEMO = {
  learner: {
    username: 'demo@example.com',
    ign: 'demo',
    password: 'demo-password-2026',
  },
  author: {
    username: 'author@example.com',
    ign: 'demo-author',
    password: 'demo-password-2026',
  },
};

// small seeded PRNG so every run looks the same
let state = 20261123;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
// deterministic-looking rating history that ends exactly at `end`
const walk = (end, n) => {
  const out = [end];
  for (let i = 1; i < n; i += 1) {
    out.unshift(Math.round(out[0] - int(-12, 22)));
  }
  return out;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// templates: [unit, build()] -> { question, right, wrongs, explanation }
const numeric = (right, spread, fmt) => {
  const set = new Set([right]);
  while (set.size < 4) set.add(right + pick([-1, 1]) * int(1, 4) * spread);
  return {
    right: fmt(right),
    wrongs: [...set].filter((v) => v !== right).map(fmt),
  };
};
const TEMPLATES = {
  Physics: [
    [
      'Kinematics',
      () => {
        const a = int(2, 6);
        const t = int(2, 8);
        const d = (a * t * t) / 2;
        return {
          q: `A car accelerates uniformly from rest at ${a} m/s^2 for ${t} s. How far does it travel?`,
          ...numeric(d, a * 2, (v) => `${v} m`),
          ex: `d = (1/2) a t^2 = 0.5 x ${a} x ${t}^2 = ${d} m.`,
        };
      },
    ],
    [
      'Linear Dynamics',
      () => {
        const m = int(2, 9);
        const f = m * int(2, 7);
        return {
          q: `A ${m} kg block is pushed by a net force of ${f} N. What is its acceleration?`,
          ...numeric(f / m, 1, (v) => `${v} m/s^2`),
          ex: `a = F / m = ${f} / ${m} = ${f / m} m/s^2.`,
        };
      },
    ],
    [
      'Energy and Momentum',
      () => {
        const m = int(1, 5);
        const v = int(2, 9);
        const e = 0.5 * m * v * v;
        return {
          q: `A ${m} kg cart moves at ${v} m/s. What is its kinetic energy?`,
          ...numeric(e, m + 2, (x) => `${x} J`),
          ex: `KE = (1/2) m v^2 = 0.5 x ${m} x ${v}^2 = ${e} J.`,
        };
      },
    ],
    [
      'Oscillations',
      () => {
        const k = pick([4, 9, 16, 25, 36, 49, 64, 100]);
        const w = Math.sqrt(k);
        return {
          q: `A 1 kg mass on a spring with k = ${k} N/m oscillates. What is its angular frequency?`,
          ...numeric(w, 1, (x) => `${x} rad/s`),
          ex: `omega = sqrt(k/m) = sqrt(${k}) = ${w} rad/s.`,
        };
      },
    ],
  ],
  Chemistry: [
    [
      'Stoichiometry',
      () => {
        const n = int(2, 9);
        return {
          q: `How many moles of water form when ${n} mol of hydrogen react completely with excess oxygen (2 H2 + O2 -> 2 H2O)?`,
          ...numeric(n, 1, (x) => `${x} mol`),
          ex: `The mole ratio H2 : H2O is 1 : 1, so ${n} mol of water form.`,
        };
      },
    ],
    [
      'Acids and Bases',
      () => {
        const p = int(1, 5);
        return {
          q: `What is the pH of a 1e-${p} M solution of a strong monoprotic acid?`,
          ...numeric(p, 1, (x) => `${x}`),
          ex: `pH = -log10(1e-${p}) = ${p}.`,
        };
      },
    ],
    [
      'Gases',
      () => {
        const p1 = int(1, 3);
        const v1 = int(2, 6);
        const p2 = p1 * int(2, 4);
        const v2 = (p1 * v1) / p2;
        return {
          q: `At constant temperature a gas at ${p1} atm occupies ${v1} L. What volume does it occupy at ${p2} atm?`,
          ...numeric(
            Math.round(v2 * 100) / 100,
            0.5,
            (x) => `${Math.abs(x)} L`,
          ),
          ex: `Boyle's law: V2 = P1 V1 / P2 = ${p1} x ${v1} / ${p2} = ${Math.round(v2 * 100) / 100} L.`,
        };
      },
    ],
  ],
  Biology: [
    [
      'Cell Biology',
      () => ({
        q: pick([
          'Which organelle produces most of the ATP in a eukaryotic cell?',
          'Where does the Krebs cycle take place in eukaryotes?',
        ]),
        right: 'Mitochondrion',
        wrongs: ['Golgi apparatus', 'Lysosome', 'Smooth ER'],
        ex: 'Oxidative phosphorylation and the Krebs cycle take place in the mitochondrion.',
      }),
    ],
    [
      'Heredity and Genetics',
      () => ({
        q: 'Two heterozygous (Aa) parents are crossed. What fraction of offspring is expected to be homozygous recessive?',
        right: '1/4',
        wrongs: ['1/2', '3/4', '0'],
        ex: 'Aa x Aa gives 1 AA : 2 Aa : 1 aa, so 1/4 are aa.',
      }),
    ],
  ],
  ESS: [
    [
      'Tectonics',
      () => ({
        q: pick([
          'At which type of plate boundary is new oceanic crust created?',
          'Which boundary type produces mid-ocean ridges?',
        ]),
        right: 'Divergent',
        wrongs: ['Convergent', 'Transform', 'Subduction'],
        ex: 'Seafloor spreads and new crust forms at divergent boundaries.',
      }),
    ],
  ],
};

async function seed(mongo) {
  const { hashPassword } = require('../utils/functions/password');
  const { subjectUnitDictionary } = require('../utils/constants/subjects');
  const now = Date.now();
  const DAY = 86400000;

  // ---- questions
  const questions = [];
  for (const [subject, templates] of Object.entries(TEMPLATES)) {
    for (const [unit, build] of templates) {
      const unitName = subjectUnitDictionary[subject].find(
        (u) => u === unit || u.startsWith(unit),
      );
      if (!unitName) continue;
      for (let i = 0; i < 14; i += 1) {
        const t = build();
        const choices = shuffle([t.right, ...t.wrongs]);
        questions.push({
          question: `<p>${t.q}</p>`,
          choices,
          tags: [],
          rating: int(900, 3300),
          answer: [String(choices.indexOf(t.right) + 1)],
          answer_ex: `<p>${t.ex} (Generated demo question.)</p>`,
          author: 'MU-DEMO',
          type: 'mc',
          ext_source: 'Original',
          subject: [subject],
          units: [`${subject} - ${unitName}`],
          stats: { pass: int(0, 60), fail: int(0, 60) },
        });
      }
    }
  }
  const docs = await mongo.Ques.insertMany(questions);

  // ---- users
  const make = async (cred, extra) => {
    const { hash, salt } = await hashPassword(cred.password);
    return new mongo.User({
      username: cred.username,
      ign: cred.ign,
      hash,
      salt,
      profile: {
        name: cred.ign,
        location: 'Earth',
        yob: 2006,
        bio: 'Demo account',
      },
      stats: {
        experience: 18000,
        correct: 0,
        wrong: 0,
        collectedTags: [],
        ratingTracker: {
          physics: walk(2100, 24),
          chemistry: walk(1700, 24),
          biology: walk(1400, 24),
          usabo: [],
          ess: walk(1200, 24),
        },
      },
      rating: {
        physics: 2100,
        chemistry: 1700,
        biology: 1400,
        usabo: -1,
        ess: 1200,
      },
      preferences: { hideProfile: false, dark_mode: false },
      achievements: { join_mutorials: true, first_physics: true },
      emailVerified: true,
      ...extra,
    }).save();
  };
  const learner = await make(DEMO.learner, {});
  await make(DEMO.author, { contributor: 'MU-DEMO' });

  // ---- answer history for the learner: Kinematics weak, Energy strong
  const expected = (u, q) => 1 / (1 + Math.pow(9, (q - u) / 1000));
  const physics = docs.filter((d) => d.subject[0] === 'Physics');
  const skill = {
    'Physics - Kinematics': -450,
    'Physics - Energy and Momentum': 450,
  };
  const attempts = [];
  let correctCount = 0;
  let wrongCount = 0;
  for (let i = 0; i < 360; i += 1) {
    const q = pick(physics);
    const unit = q.units[0];
    const u = 2100;
    const qr = Math.min(3500, Math.max(900, u + int(-500, 500)));
    const correct = rand() < expected(u + (skill[unit] || 0), qr);
    correct ? (correctCount += 1) : (wrongCount += 1);
    attempts.push({
      user: learner._id,
      question: q._id,
      bank: 'standard',
      subject: 'physics',
      units: q.units,
      correct,
      choice: [String(correct ? q.answer[0] : (Number(q.answer[0]) % 4) + 1)],
      rated: true,
      mode: 'classic',
      userRatingBefore: u,
      userRatingAfter: u,
      questionRatingBefore: qr,
      questionRatingAfter: qr,
      createdAt: new Date(now - rand() * 28 * DAY),
    });
  }
  // a handful of recent misses so the review queue has work in it
  for (const [i, q] of physics.slice(0, 6).entries()) {
    attempts.push({
      user: learner._id,
      question: q._id,
      bank: 'standard',
      subject: 'physics',
      units: q.units,
      correct: false,
      choice: [String((Number(q.answer[0]) % 4) + 1)],
      rated: true,
      mode: 'classic',
      userRatingBefore: 2100,
      userRatingAfter: 2090,
      questionRatingBefore: q.rating,
      questionRatingAfter: q.rating,
      createdAt: new Date(now - (2 + i * 4) * DAY),
    });
  }
  await mongo.Attempt.insertMany(attempts);
  await mongo.User.updateOne(
    { _id: learner._id },
    {
      $set: {
        'stats.correct': correctCount,
        'stats.wrong': wrongCount,
        'stats.attempts.physics': attempts.length,
      },
    },
  );

  // ---- crowd answers on the author's questions so item analysis has content;
  // one question gets a deliberately wrong key
  const crowd = [];
  const suspect = physics[10];
  await mongo.Ques.updateOne(
    { _id: suspect._id },
    { $set: { answer: [String((Number(suspect.answer[0]) % 4) + 1)] } },
  );
  for (const q of docs) {
    const n = q._id.equals(suspect._id) ? 40 : int(0, 45);
    for (let i = 0; i < n; i += 1) {
      const u = int(1200, 3600);
      const truthRight = suspect._id.equals(q._id)
        ? suspect.answer[0]
        : q.answer[0];
      const right = rand() < expected(u, q.rating);
      const wrong = String((Number(truthRight) % 4) + 1);
      const chosen = right ? truthRight : wrong;
      crowd.push({
        user: new (require('mongoose').Types.ObjectId)(),
        question: q._id,
        bank: 'standard',
        subject: q.subject[0].toLowerCase(),
        units: q.units,
        correct:
          chosen === q.answer[0] || (suspect._id.equals(q._id) ? false : right),
        choice: [chosen],
        rated: true,
        mode: 'classic',
        userRatingBefore: u,
        userRatingAfter: u,
        questionRatingBefore: q.rating,
        questionRatingAfter: q.rating,
        createdAt: new Date(now - rand() * 20 * DAY),
      });
    }
  }
  await mongo.Attempt.insertMany(crowd);
  return docs.length;
}

async function main() {
  const server = await MongoMemoryServer.create();
  process.env.DB_URL = server.getUri('mutorials_demo');
  const mongo = require('../utils/functions/mongo');
  await mongo.connected;
  const { ensureSiteData } = require('../utils/functions/database');
  await ensureSiteData(mongo.SiteData);
  const count = await seed(mongo);
  const config = require('../utils/config');
  const app = require('../app');
  http.createServer(app).listen(config.PORT, () => {
    console.log(`\nMutorials demo ready with ${count} generated questions.`);
    console.log(`  http://localhost:${config.PORT}`);
    console.log(
      `  learner:  ${DEMO.learner.username} / ${DEMO.learner.password}`,
    );
    console.log(
      `  author:   ${DEMO.author.username} / ${DEMO.author.password}  (item analysis at /contributors/items)`,
    );
    console.log(
      'Data is in memory and disappears when you stop this process.\n',
    );
  });
  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
