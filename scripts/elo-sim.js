#!/usr/bin/env node
/**
 * Offline comparison of the legacy rating rule (v1) and the uncertainty-aware
 * rule (v2) used by Mutorials' adaptive trainer.
 *
 *   node scripts/elo-sim.js [--seeds 10] [--users 300] [--questions 400]
 *                           [--rounds 150] [--guess 0.2] [--json]
 *
 * Simulated world
 *   - every learner has a latent ability theta ~ N(2500, 800) (floored at 100);
 *   - every question has a latent difficulty b ~ U(500, 4500);
 *   - question ratings start as b + N(0, 600): a contributor's guess;
 *   - learner ratings start as theta + N(0, 700): the coarse self-placement the
 *     site asks for at sign-up;
 *   - each round every learner answers one unseen question drawn from the same
 *     rating window the trainer uses (ratingCeilingFloor), and answers correctly
 *     with probability g + (1 - g) * expectedScore(theta, b).
 *
 * Metrics (lower is better unless stated)
 *   - user RMSE / question RMSE against the latent truth. The scale of an Elo
 *     system is only identified up to a shift, so the offset-centred RMSE is
 *     reported alongside the raw one;
 *   - prequential log-loss: how well the ratings predicted each answer before it
 *     was observed, averaged over a window of rounds.
 *
 * Limitations (read before quoting numbers): the simulator's response model is
 * the same logistic that the engines assume, so absolute errors are optimistic;
 * the --guess scenario adds a guessing floor to probe misspecification. Real
 * learners also improve over time (non-stationarity), which is not simulated.
 */
const {
  calculateRatings,
  calculateRatingsLegacy,
  expectedScore,
  ratingCeilingFloor,
} = require('../utils/functions/siteAlgorithms');

function parseArgs(argv) {
  const out = {
    seeds: 10,
    users: 300,
    questions: 400,
    rounds: 150,
    guess: 0,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      out.json = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (!(key in out)) {
        throw new Error(`unknown option ${arg}`);
      }
      out[key] = Number(argv[(i += 1)]);
      if (!Number.isFinite(out[key])) {
        throw new Error(`option ${arg} needs a number`);
      }
    }
  }
  return out;
}

// Seeded PRNG (mulberry32) so runs are reproducible.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function rmse(estimates, truth, centred) {
  const diffs = estimates.map((e, i) => e - truth[i]);
  const offset = centred ? mean(diffs) : 0;
  return Math.sqrt(mean(diffs.map((d) => (d - offset) ** 2)));
}

// lowest index whose value is >= target in an ascending array
function lowerBound(sorted, target) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function simulate(engine, seed, cfg) {
  const rng = makeRng(seed);
  const users = Array.from({ length: cfg.users }, () => {
    const theta = Math.max(100, 2500 + 800 * gaussian(rng));
    return {
      theta,
      rating: Math.max(1, Math.round(theta + 700 * gaussian(rng))),
      n: 0,
      seen: new Set(),
    };
  });
  const questions = Array.from({ length: cfg.questions }, () => {
    const b = 500 + 4000 * rng();
    return {
      b,
      rating: Math.max(1, Math.round(b + 600 * gaussian(rng))),
      n: 0,
    };
  });

  const checkpoints = [10, 25, 50, 100, cfg.rounds].filter(
    (r, i, arr) => r <= cfg.rounds && arr.indexOf(r) === i,
  );
  const snapshots = [];
  let windowLoss = [];

  for (let round = 1; round <= cfg.rounds; round += 1) {
    // snapshot ordering once per round; ratings read at answer time are live
    const order = questions
      .map((q, idx) => ({ idx, rating: q.rating }))
      .sort((a, b) => a.rating - b.rating);
    const ratings = order.map((o) => o.rating);

    for (const user of users) {
      const { floor, ceiling } = ratingCeilingFloor(user.rating);
      const lo = lowerBound(ratings, floor);
      const hi = lowerBound(ratings, ceiling + 1);
      let chosen = -1;
      for (let attempt = 0; attempt < 12 && hi > lo; attempt += 1) {
        const cand = order[lo + Math.floor(rng() * (hi - lo))].idx;
        if (!user.seen.has(cand)) {
          chosen = cand;
          break;
        }
      }
      if (chosen < 0) {
        // empty or exhausted window: fall back to the nearest unseen question
        let best = Infinity;
        questions.forEach((q, idx) => {
          const gap = Math.abs(q.rating - user.rating);
          if (!user.seen.has(idx) && gap < best) {
            best = gap;
            chosen = idx;
          }
        });
        if (chosen < 0) {
          continue;
        }
      }
      user.seen.add(chosen);
      const q = questions[chosen];

      const pTrue =
        cfg.guess + (1 - cfg.guess) * expectedScore(user.theta, q.b);
      const correct = rng() < pTrue;

      const pPred = Math.min(
        1 - 1e-9,
        Math.max(1e-9, expectedScore(user.rating, q.rating)),
      );
      windowLoss.push(-Math.log(correct ? pPred : 1 - pPred));

      const next =
        engine === 'v2'
          ? calculateRatings(user.rating, q.rating, correct, {
              userAttempts: user.n,
              questionAttempts: q.n,
            })
          : calculateRatingsLegacy(user.rating, q.rating, correct);
      user.rating = next.newUserRating;
      q.rating = next.newQuestionRating;
      user.n += 1;
      q.n += 1;
    }

    if (checkpoints.includes(round)) {
      const thetas = users.map((u) => u.theta);
      const urs = users.map((u) => u.rating);
      const bs = questions.map((q) => q.b);
      const qrs = questions.map((q) => q.rating);
      snapshots.push({
        round,
        userRmse: rmse(urs, thetas, false),
        userRmseCentred: rmse(urs, thetas, true),
        questionRmse: rmse(qrs, bs, false),
        questionRmseCentred: rmse(qrs, bs, true),
        logLoss: mean(windowLoss),
      });
      windowLoss = [];
    }
  }
  return snapshots;
}

function aggregate(runs) {
  const rounds = runs[0].map((s) => s.round);
  return rounds.map((round, i) => {
    const cell = (key) => {
      const vals = runs.map((r) => r[i][key]);
      return { mean: mean(vals), sd: sd(vals) };
    };
    return {
      round,
      userRmse: cell('userRmse'),
      userRmseCentred: cell('userRmseCentred'),
      questionRmse: cell('questionRmse'),
      questionRmseCentred: cell('questionRmseCentred'),
      logLoss: cell('logLoss'),
    };
  });
}

function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const result = {};
  for (const engine of ['v1', 'v2']) {
    const runs = [];
    for (let s = 0; s < cfg.seeds; s += 1) {
      // identical seeds for both engines: paired comparison
      runs.push(simulate(engine, 1000 + s, cfg));
    }
    result[engine] = aggregate(runs);
  }

  if (cfg.json) {
    console.log(JSON.stringify({ config: cfg, result }, null, 2));
    return;
  }

  const fmt = (c, digits = 0) =>
    `${c.mean.toFixed(digits)} ±${c.sd.toFixed(digits)}`;
  console.log(
    `Rating-engine simulation: ${cfg.seeds} seeds, ${cfg.users} learners, ` +
      `${cfg.questions} questions, guess floor ${cfg.guess}`,
  );
  console.log('Values are mean ± sd across seeds (paired seeds for v1/v2).\n');
  console.log(
    'round | engine | user RMSE | user RMSE (centred) | question RMSE | question RMSE (centred) | log-loss (window)',
  );
  console.log(
    '------|--------|-----------|---------------------|---------------|-------------------------|------------------',
  );
  result.v1.forEach((_, i) => {
    for (const engine of ['v1', 'v2']) {
      const r = result[engine][i];
      console.log(
        `${String(r.round).padStart(5)} | ${engine.padEnd(6)} | ${fmt(r.userRmse).padEnd(9)} | ${fmt(r.userRmseCentred).padEnd(19)} | ${fmt(r.questionRmse).padEnd(13)} | ${fmt(r.questionRmseCentred).padEnd(23)} | ${fmt(r.logLoss, 4)}`,
      );
    }
  });
}

main();
