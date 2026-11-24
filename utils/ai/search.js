// Meaning-based question search. Complements the keyword search in
// utils/functions/database.js: it embeds the query with the same small
// open-weight model used for related questions and ranks live questions by
// cosine similarity. It only ever adds results; it never replaces keyword hits.
const { toPlainText } = require('./text');

const MIN_QUERY = 4;
const MAX_QUERY = 200;
const CANDIDATES = 60;
const MIN_SCORE = 0.3;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 20;

// per-user sliding window; semantic search is an optional extra, so a learner
// over the limit simply gets keyword results only
const recent = new Map();
function allow(key, now = Date.now()) {
  const stamps = (recent.get(key) || []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (stamps.length >= RATE_LIMIT) {
    recent.set(key, stamps);
    return false;
  }
  stamps.push(now);
  recent.set(key, stamps);
  if (recent.size > 5000) {
    for (const [k, v] of recent) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) recent.delete(k);
    }
  }
  return true;
}

const list = (value) =>
  typeof value === 'string' && value.trim()
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const snippet = (html, max = 200) => {
  const text = toPlainText(html, 600).replace(/\s+/g, ' ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
};

/**
 * Returns up to `limit` question results ranked by similarity to `query.text`.
 * `exclude` is a Set of question ids already shown by the keyword search.
 * Returns [] when the text is too short or looks like an id, when the user is
 * over the rate limit, or when the index has nothing relevant.
 */
async function semanticQuestions({
  mongo,
  index,
  userKey,
  query,
  exclude = new Set(),
  limit = 8,
}) {
  const text = toPlainText(
    typeof query.text === 'string' ? query.text : '',
    MAX_QUERY,
  );
  if (text.length < MIN_QUERY || /^[0-9a-f]{24}$/i.test(text)) {
    return [];
  }
  if (!allow(userKey)) {
    return [];
  }
  await index.ensureSynced();
  const { hits } = await index.nearestLive(text, {
    k: CANDIDATES,
    minScore: MIN_SCORE,
  });
  const candidates = hits.filter((hit) => !exclude.has(String(hit.id)));
  if (candidates.length === 0) {
    return [];
  }

  const filters = [];
  const subjects = list(query.subjects);
  const units = list(query.units);
  const tags = list(query.tags);
  if (subjects.length > 0) filters.push({ subject: { $all: subjects } });
  if (units.length > 0) filters.push({ units: { $all: units } });
  if (tags.length > 0) filters.push({ tags: { $all: tags } });

  const docs = await mongo.Ques.find({
    $and: [{ _id: { $in: candidates.map((c) => c.id) } }, ...filters],
  })
    .select('question subject rating')
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return candidates
    .filter((c) => byId.has(String(c.id)))
    .slice(0, limit)
    .map((c) => {
      const q = byId.get(String(c.id));
      return {
        type: 'QUESTION',
        id: q._id,
        title: `${q.subject[0]} (${q.rating} Rated)`,
        preview: snippet(q.question),
        score: Math.round(c.score * 100) / 100,
      };
    });
}

module.exports = { semanticQuestions, allow, MIN_QUERY, MAX_QUERY };
