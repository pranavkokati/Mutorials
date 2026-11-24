process.env.NODE_ENV = 'test';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  hashPassword,
  verifyPassword,
  needsRehash,
  passwordPolicyError,
} = require('../utils/functions/password');
const { safeLocalPath, asString } = require('../utils/functions/http');
const { containsOperatorKey } = require('../utils/middleware/security');
const {
  gradeAnswer,
  sameAnswerSet,
  freeResponseMatches,
} = require('../utils/functions/answers');
const {
  calculateRatings,
  calculateRatingsLegacy,
  expectedScore,
  stepSize,
  ENGINE,
} = require('../utils/functions/siteAlgorithms');
const { parseQuestionForm } = require('../utils/functions/questionInput');
const { subjectUnitDictionary } = require('../utils/constants/subjects');
const { isValidId, toObjectId } = require('../utils/functions/ids');

test('scrypt hash verifies, rejects wrong passwords, and is salted', async () => {
  const a = await hashPassword('Sup3r-secret');
  const b = await hashPassword('Sup3r-secret');
  assert.match(a.hash, /^scrypt\$15\$8\$3\$[0-9a-f]+$/);
  assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword('Sup3r-secret', a.hash, a.salt), true);
  assert.equal(await verifyPassword('Sup3r-secreT', a.hash, a.salt), false);
  assert.equal(needsRehash(a.hash), false);
});

test('legacy PBKDF2 hashes still verify and are flagged for rehash', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const legacy = crypto
    .pbkdf2Sync('old-pass1', salt, 10000, 64, 'sha512')
    .toString('hex');
  assert.equal(await verifyPassword('old-pass1', legacy, salt), true);
  assert.equal(await verifyPassword('old-pass2', legacy, salt), false);
  assert.equal(needsRehash(legacy), true);
});

test('verifyPassword tolerates malformed input without throwing', async () => {
  assert.equal(await verifyPassword(undefined, 'x', 'y'), false);
  assert.equal(await verifyPassword('a'.repeat(10000), 'x', 'y'), false);
  assert.equal(await verifyPassword('abc', null, 'y'), false);
});

test('password policy', () => {
  assert.equal(passwordPolicyError('abcdef1'), null);
  assert.ok(passwordPolicyError('short1'));
  assert.ok(passwordPolicyError('nodigitshere'));
  assert.ok(passwordPolicyError('1234567890'));
  assert.ok(passwordPolicyError('a1'.repeat(100)));
  assert.ok(passwordPolicyError({ $ne: '' }));
});

test('safeLocalPath only allows same-site relative paths', () => {
  assert.equal(safeLocalPath('/train', '/'), '/train');
  for (const bad of [
    '//evil.com',
    'https://evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    '',
    undefined,
    {},
  ]) {
    assert.equal(safeLocalPath(bad, '/'), '/', JSON.stringify(bad));
  }
});

test('asString coerces non-strings to empty', () => {
  assert.equal(asString('x'), 'x');
  assert.equal(asString({ $ne: 1 }), '');
  assert.equal(asString(['a']), '');
});

test('operator-key detection finds nested $ keys', () => {
  assert.equal(containsOperatorKey({ a: 1 }), false);
  assert.equal(containsOperatorKey({ a: { $ne: '' } }), true);
  assert.equal(containsOperatorKey({ a: [{ b: { $where: 'x' } }] }), true);
  assert.equal(containsOperatorKey('plain'), false);
});

test('object id helpers reject junk', () => {
  assert.equal(isValidId('507f1f77bcf86cd799439011'), true);
  assert.equal(isValidId({ $ne: 1 }), false);
  assert.equal(toObjectId('nope'), null);
  assert.ok(toObjectId('507f1f77bcf86cd799439011'));
});

test('grading: multiple choice, select-all (order-insensitive) and free response', () => {
  assert.deepEqual(
    gradeAnswer({ answer: ['B'] }, { type: 'mc', answerChoice: 'B' }).correct,
    true,
  );
  assert.deepEqual(
    gradeAnswer({ answer: ['B'] }, { type: 'mc', answerChoice: 'C' }).correct,
    false,
  );
  assert.equal(sameAnswerSet(['A', 'C'], ['C', 'A']), true);
  assert.equal(sameAnswerSet(['A', 'C'], 'A'), false);
  assert.equal(
    gradeAnswer({ answer: ['A', 'C'] }, { type: 'sa', saChoice: ['C', 'A'] })
      .correct,
    true,
  );
  assert.equal(freeResponseMatches(['9.8'], ' 9.8 '), true);
  assert.equal(freeResponseMatches(['9.8'], '9.81'), false);
  // no answer supplied is not graded (treated as a skip by the route)
  assert.equal(gradeAnswer({ answer: ['A'] }, { type: 'mc' }), null);
  assert.equal(
    gradeAnswer({ answer: ['A'] }, { type: 'fr', freeAnswer: '   ' }),
    null,
  );
});

test('question form validation', () => {
  const subject = Object.keys(subjectUnitDictionary)[0];
  const unit = subject + ' - ' + subjectUnitDictionary[subject][0];
  const valid = {
    question: 'What is 1+1?',
    answerExplanation: 'Because.',
    type: 'mc',
    externalSource: 'Original',
    rating: '1200',
    answer: 'B',
    choices: 'A@B@C',
    subject: [subject],
    units: [unit],
    tags: 'math',
    author: 'MU1',
  };
  const ok = parseQuestionForm(valid, {
    requireAuthor: true,
    requireTags: true,
  });
  assert.ok(ok.data, JSON.stringify(ok));
  assert.equal(typeof ok.data.rating, 'number');
  assert.deepEqual(ok.data.choices, ['A', 'B', 'C']);

  for (const [field, value] of [
    ['rating', '12.5'],
    ['rating', '-1'],
    ['rating', '99999'],
    ['type', 'evil'],
    ['question', ''],
    ['answer', ''],
    ['subject', ['NotASubject']],
  ]) {
    assert.ok(
      parseQuestionForm({ ...valid, [field]: value }, { requireAuthor: true })
        .error,
      `${field}=${value}`,
    );
  }
  // operator objects are coerced, not passed through to the database
  const injected = parseQuestionForm({ ...valid, question: { $ne: 1 } });
  assert.ok(injected.error);
});

// ------------------------------------------------------------ rating engine

test('expectedScore is 0.5 at equal ratings and 0.9 at a 1000-point advantage', () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
  assert.ok(Math.abs(expectedScore(2500, 1500) - 0.9) < 1e-12);
  assert.ok(Math.abs(expectedScore(1500, 2500) - 0.1) < 1e-12);
});

test('step size shrinks monotonically with attempts and bottoms out at kInf', () => {
  for (const cfg of [ENGINE.user, ENGINE.question]) {
    let last = Infinity;
    for (const n of [0, 1, 5, 20, 100, 1000, 100000]) {
      const k = stepSize(cfg, n);
      assert.ok(k < last, `K(${n}) should be below the previous value`);
      assert.ok(k > cfg.kInf);
      last = k;
    }
    assert.equal(stepSize(cfg, Infinity), cfg.kInf);
    assert.equal(stepSize(cfg, undefined), stepSize(cfg, 0));
    assert.equal(stepSize(cfg, -5), stepSize(cfg, 0));
  }
});

test('v2 updates are zero-sum in direction: a miss lowers the learner and raises the question', () => {
  const miss = calculateRatings(2000, 2000, false, {
    userAttempts: 3,
    questionAttempts: 3,
  });
  assert.ok(miss.newUserRating < 2000);
  assert.ok(miss.newQuestionRating > 2000);
  const hit = calculateRatings(2000, 2000, true, {
    userAttempts: 3,
    questionAttempts: 3,
  });
  assert.ok(hit.newUserRating > 2000);
  assert.ok(hit.newQuestionRating < 2000);
});

test('v2 rewards upsets more than expected results', () => {
  const upset = calculateRatings(1000, 3000, true, {});
  const expected = calculateRatings(3000, 1000, true, {});
  assert.ok(upset.newUserRating - 1000 > expected.newUserRating - 3000);
});

test('v2 learners with little history move faster than veterans', () => {
  const newcomer = calculateRatings(1500, 1500, true, { userAttempts: 0 });
  const veteran = calculateRatings(1500, 1500, true, { userAttempts: 500 });
  assert.ok(newcomer.newUserRating - 1500 > veteran.newUserRating - 1500);
});

test('v2 moves a question on an even match where legacy froze it', () => {
  const legacy = calculateRatingsLegacy(1200, 1200, false);
  assert.equal(legacy.newQuestionRating, 1200);
  const v2 = calculateRatings(1200, 1200, false, {
    userAttempts: 50,
    questionAttempts: 50,
  });
  assert.ok(v2.newQuestionRating > 1200);
});

test('ratings never fall below 1 and results are integers', () => {
  const low = calculateRatings(1, 5000, false, {
    userAttempts: 0,
    questionAttempts: 0,
  });
  assert.equal(low.newUserRating, 1);
  const q = calculateRatings(5000, 1, true, {
    userAttempts: 0,
    questionAttempts: 0,
  });
  assert.equal(q.newQuestionRating, 1);
  const r = calculateRatings(1234, 2345, true, {
    userAttempts: 7,
    questionAttempts: 9,
  });
  assert.ok(Number.isInteger(r.newUserRating));
  assert.ok(Number.isInteger(r.newQuestionRating));
});

test('without attempt counts v2 matches the legacy learner step for an established learner', () => {
  // K_inf (user) is 16, identical to the legacy constant
  for (const [u, qr] of [
    [1500, 1500],
    [2000, 1200],
    [900, 2400],
  ]) {
    for (const correct of [true, false]) {
      assert.equal(
        calculateRatings(u, qr, correct).newUserRating,
        calculateRatingsLegacy(u, qr, correct).newUserRating,
      );
    }
  }
});
