// Item analysis for question authors: is the rating calibrated, do the wrong
// options do any work, and could the answer key be wrong? Pure functions over
// the Attempt log; only aggregate counts leave this module, never user ids.
// See docs/ITEM-ANALYSIS.md for the reasoning and limits.
const { expectedScore } = require('./siteAlgorithms');

const ITEM = Object.freeze({
  // attempts needed before a calibration verdict is given
  minCalibration: 30,
  zThreshold: 1.96,
  // option counts are shown only once this many choices are recorded, so a
  // handful of answers cannot be traced to individual learners
  minOptionCell: 10,
  // attempts needed before a distractor is called non-functional
  minDistractor: 30,
  deadShare: 0.05,
  // "strong" answerers: expected to win at least 75 % of the time
  strongExpected: 0.75,
  minStrong: 10,
});

const round = (value, digits) => {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
};

/**
 * question: { type, choices, answer }
 * attempts: [{ correct, choice, userRatingBefore, questionRatingBefore }]
 */
function analyzeItem(question, attempts, options = {}) {
  const cfg = { ...ITEM, ...options };
  const rated = attempts.filter(
    (a) =>
      Number.isFinite(a.userRatingBefore) &&
      a.userRatingBefore >= 0 &&
      Number.isFinite(a.questionRatingBefore),
  );

  // calibration: observed pass rate against what the ratings predicted
  let expectedSum = 0;
  let variance = 0;
  let passes = 0;
  for (const a of rated) {
    const p = expectedScore(a.userRatingBefore, a.questionRatingBefore);
    expectedSum += p;
    variance += p * (1 - p);
    passes += a.correct ? 1 : 0;
  }
  const n = rated.length;
  const z = variance > 0 ? (passes - expectedSum) / Math.sqrt(variance) : 0;
  let calibration = 'insufficient';
  if (n >= cfg.minCalibration) {
    if (z <= -cfg.zThreshold) {
      calibration = 'harder-than-rated';
    } else if (z >= cfg.zThreshold) {
      calibration = 'easier-than-rated';
    } else {
      calibration = 'ok';
    }
  }

  const result = {
    attempts: n,
    passRate: n ? round(passes / n, 3) : null,
    expectedPassRate: n ? round(expectedSum / n, 3) : null,
    z: round(z, 2),
    calibration,
    options: null,
    flags: [],
  };

  if (question.type === 'mc') {
    const optionCount = (question.choices || []).length;
    const correctIndex = String((question.answer || [])[0]);
    const withChoice = rated.filter((a) => (a.choice || []).length === 1);
    const counts = new Array(optionCount).fill(0);
    withChoice.forEach((a) => {
      const i = Number(a.choice[0]);
      if (i >= 1 && i <= optionCount) counts[i - 1] += 1;
    });
    const recorded = counts.reduce((a, b) => a + b, 0);

    if (recorded >= cfg.minOptionCell) {
      result.options = counts.map((count, i) => ({
        option: i + 1,
        correct: String(i + 1) === correctIndex,
        count,
        share: round(count / recorded, 3),
      }));
    }

    if (recorded >= cfg.minDistractor) {
      counts.forEach((count, i) => {
        if (
          String(i + 1) !== correctIndex &&
          count / recorded < cfg.deadShare
        ) {
          result.flags.push({ type: 'unused-distractor', option: i + 1 });
        }
      });
    }

    // Possible key error or ambiguity: among learners expected to answer
    // correctly, a wrong option is chosen more often than the keyed one.
    const strong = withChoice.filter(
      (a) =>
        expectedScore(a.userRatingBefore, a.questionRatingBefore) >=
        cfg.strongExpected,
    );
    if (strong.length >= cfg.minStrong) {
      const strongCounts = new Array(optionCount).fill(0);
      strong.forEach((a) => {
        const i = Number(a.choice[0]);
        if (i >= 1 && i <= optionCount) strongCounts[i - 1] += 1;
      });
      const keyedCount = strongCounts[Number(correctIndex) - 1] || 0;
      let topWrong = 0;
      let topWrongOption = null;
      strongCounts.forEach((count, i) => {
        if (String(i + 1) !== correctIndex && count > topWrong) {
          topWrong = count;
          topWrongOption = i + 1;
        }
      });
      if (topWrong > keyedCount) {
        result.flags.push({
          type: 'possible-key-error',
          option: topWrongOption,
          strongAttempts: strong.length,
          keyedShare: round(keyedCount / strong.length, 3),
          wrongShare: round(topWrong / strong.length, 3),
        });
      }
    }
  }

  return result;
}

module.exports = { ITEM, analyzeItem };
