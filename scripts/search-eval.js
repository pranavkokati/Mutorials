#!/usr/bin/env node
// Pilot retrieval check for semantic search. Each hand-written query paraphrases
// one question in scripts/ai-eval-questions.json without copying its wording;
// the gold answer is that question. Compares the production embedder with a
// plain TF-IDF cosine baseline over the same 10 questions.
//
//   node scripts/search-eval.js      (downloads the embedding model on first use)
//
// n = 10 queries over a 10-question bank: enough to catch a broken pipeline and
// to show the direction of the difference, not enough for statistical claims.
const path = require('path');
const questions = require('./ai-eval-questions.json');
const { createBackend } = require('../utils/ai/backend');
const { textFor } = require('../utils/ai/similarity');

const QUERIES = {
  p1: 'distance covered by a vehicle that speeds up steadily from standstill',
  p2: 'acceleration of a small mass sliding along a smooth slope',
  p3: 'how fast is a falling object moving right before it hits the ground',
  p4: 'natural frequency of a weight hanging on a spring',
  c1: 'amount of H2O formed from burning two moles of hydrogen',
  c2: 'acidity of dilute hydrochloric acid',
  c3: 'compressing a gas at fixed temperature, what happens to its volume',
  b1: 'which part of the cell makes the energy currency molecule',
  b2: 'chance that a child of two carriers shows the recessive trait',
  b3: 'what reactions take place inside the powerhouse of the cell',
};

const tokens = (s) => s.toLowerCase().match(/[a-z0-9]+/g) || [];

function tfidf(docs) {
  const df = new Map();
  docs.forEach((d) =>
    new Set(d).forEach((t) => df.set(t, (df.get(t) || 0) + 1)),
  );
  const idf = (t) => Math.log((1 + docs.length) / (1 + (df.get(t) || 0))) + 1;
  const vec = (d) => {
    const v = new Map();
    d.forEach((t) => v.set(t, (v.get(t) || 0) + 1));
    for (const [t, c] of v) v.set(t, c * idf(t));
    const norm = Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0)) || 1;
    for (const [t, c] of v) v.set(t, c / norm);
    return v;
  };
  return vec;
}
const cosine = (a, b) => {
  let sum = 0;
  for (const [t, x] of a) if (b.has(t)) sum += x * b.get(t);
  return sum;
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

function score(rankings) {
  let top1 = 0;
  let top3 = 0;
  let rr = 0;
  for (const { gold, order } of rankings) {
    const rank = order.indexOf(gold) + 1;
    if (rank === 1) top1 += 1;
    if (rank >= 1 && rank <= 3) top3 += 1;
    if (rank >= 1) rr += 1 / rank;
  }
  const n = rankings.length;
  return { top1: top1 / n, top3: top3 / n, mrr: rr / n };
}

async function main() {
  const backend = createBackend({
    enabled: true,
    llmEnabled: false,
    offline: false,
    embedModel: 'Xenova/all-MiniLM-L6-v2',
    llmModel: '',
    llmDtype: 'q4',
    cacheDir:
      process.env.AI_CACHE_DIR ||
      path.join(__dirname, '..', '.cache', 'models'),
    maxNewTokens: 1,
    generationTimeoutMs: 60000,
    maxQueue: 10,
  });
  const docs = questions.map(textFor);
  const docVecs = await backend.embed(docs);
  const queryIds = Object.keys(QUERIES);
  const queryVecs = await backend.embed(queryIds.map((id) => QUERIES[id]));

  const semantic = queryIds.map((gold, i) => ({
    gold,
    order: questions
      .map((q, j) => ({ id: q.id, s: dot(queryVecs[i], docVecs[j]) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.id),
    scores: questions.map((q, j) => dot(queryVecs[i], docVecs[j])),
  }));

  const vec = tfidf(docs.map(tokens));
  const dvs = docs.map((d) => vec(tokens(d)));
  const lexical = queryIds.map((gold) => {
    const qv = vec(tokens(QUERIES[gold]));
    return {
      gold,
      order: questions
        .map((q, j) => ({ id: q.id, s: cosine(qv, dvs[j]) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.id),
    };
  });

  const goldScores = semantic.map(
    (r) => r.scores[questions.findIndex((q) => q.id === r.gold)],
  );
  const otherScores = semantic.flatMap((r) =>
    r.scores.filter((_, j) => questions[j].id !== r.gold),
  );
  console.log(
    'n =',
    queryIds.length,
    'queries over',
    questions.length,
    'questions',
  );
  console.log('embedding (MiniLM):', score(semantic));
  console.log('TF-IDF baseline  :', score(lexical));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    'cosine to gold   : mean %s min %s',
    mean(goldScores).toFixed(2),
    Math.min(...goldScores).toFixed(2),
  );
  console.log(
    'cosine to others : mean %s max %s',
    mean(otherScores).toFixed(2),
    Math.max(...otherScores).toFixed(2),
  );
  const above = semantic.map(
    (r) =>
      r.scores.filter((x, j) => questions[j].id !== r.gold && x >= 0.3).length,
  );
  console.log(
    'non-gold questions at or above the 0.3 cutoff, per query: mean %s',
    mean(above).toFixed(1),
  );
  semantic.forEach((r) => {
    if (r.order[0] !== r.gold)
      console.log('miss:', r.gold, '-> top', r.order.slice(0, 3).join(','));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
