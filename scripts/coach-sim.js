#!/usr/bin/env node
/**
 * Operating characteristics of the study coach's weak-spot classifier.
 *
 *   node scripts/coach-sim.js [--trials 4000]
 *
 * For a learner rated 2000 whose questions are drawn near their rating
 * (N(2000, 150)), a unit has a true deficit of `d` rating points: the learner
 * answers as if rated 2000 - d there. Reports the fraction of simulated units
 * classified "weak" for several deficits and attempt counts. d = 0 gives the
 * false-positive rate; d > 0 gives power. The response model is the same
 * logistic the coach assumes, so power is optimistic for real learners.
 */
const { unitPerformance } = require('../utils/functions/coach');
const { expectedScore } = require('../utils/functions/siteAlgorithms');

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  return (
    Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) *
    Math.cos(2 * Math.PI * rng())
  );
}

const trialsArg = process.argv.indexOf('--trials');
const trials = trialsArg > -1 ? Number(process.argv[trialsArg + 1]) : 4000;
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const rng = makeRng(2026);

const deficits = [0, 200, 400, 800];
const sizes = [5, 10, 20, 40];
console.log(`Share of units classified "weak" (${trials} trials per cell)\n`);
console.log(['deficit \\ n'].concat(sizes.map((n) => `n=${n}`)).join('\t'));
for (const d of deficits) {
  const row = [`${d} pts`];
  for (const n of sizes) {
    let weak = 0;
    for (let t = 0; t < trials; t += 1) {
      const attempts = [];
      for (let i = 0; i < n; i += 1) {
        const q = 2000 + 150 * gaussian(rng);
        const correct = rng() < expectedScore(2000 - d, q);
        attempts.push({
          subject: 'physics',
          units: ['Physics - X'],
          correct,
          rated: true,
          userRatingBefore: 2000,
          questionRatingBefore: q,
          createdAt: new Date(now - rng() * 14 * DAY),
        });
      }
      const [unit] = unitPerformance(attempts, now);
      if (unit.status === 'weak') {
        weak += 1;
      }
    }
    row.push(`${((100 * weak) / trials).toFixed(1)}%`);
  }
  console.log(row.join('\t'));
}
