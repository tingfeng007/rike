import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SAMPLE_ARTICLES } from '../src/data/samples.js';
import { builtInReadingQuestions, normalizeReadingQuestions, readingArticleVersion, readingPracticeEvidence, restoreReadingPractice } from '../src/services/readingPractice.js';

test('all builtin articles have grounded questions, edited article content cannot reuse stale questions', () => {
  for (const article of DEFAULT_SAMPLE_ARTICLES) {
    const questions = builtInReadingQuestions(article);
    assert.ok(questions.length >= 2 && questions.length <= 3);
    assert.ok(questions.every((question) => question.options[question.correctIndex] && question.explanation));
    assert.deepEqual(builtInReadingQuestions({ ...article, content: 'Different content.' }), []);
    assert.notEqual(readingArticleVersion(article), readingArticleVersion({ ...article, content: 'Different content.' }));
  }
});

test('reading evidence requires actual answers and a timed English retelling; AI generation is optional for imports', () => {
  const questions = builtInReadingQuestions(DEFAULT_SAMPLE_ARTICLES[0]);
  const base = { questions, answers: Object.fromEntries(questions.map((question) => [question.id, question.correctIndex])), retellingText: 'Coffee shops connect our work and home.', quizChecked: true };
  assert.equal(readingPracticeEvidence({ ...base, retellingSeconds: 29 }).complete, false);
  assert.equal(readingPracticeEvidence({ ...base, retellingSeconds: 30 }).complete, true);
  assert.equal(readingPracticeEvidence({ ...base, retellingSeconds: 30, answers: {} }).complete, false);
  assert.equal(readingPracticeEvidence({ ...base, retellingSeconds: 30, quizChecked: false }).complete, false);
  assert.equal(readingPracticeEvidence({ retellingText: 'The author recommends consistent daily learning habits.', retellingSeconds: 30 }).complete, true);
  assert.equal(readingPracticeEvidence({ retellingText: '你好', retellingSeconds: 30 }).complete, false);
});

test('malformed AI questions are rejected instead of showing incomplete quizzes', () => {
  assert.throws(() => normalizeReadingQuestions({ questions: [{ prompt: 'Q', options: ['A', 'B', 'C'], correctIndex: 6 }] }));
  assert.throws(() => normalizeReadingQuestions({ questions: [null, { prompt: 'Q', options: ['A', 'A', 'B'], correctIndex: 0 }] }));
  const raw = { questions: [1, 2].map((id) => ({ prompt: `Question ${id}`, options: ['A', 'B', 'C'], correctIndex: 0, explanation: 'Text evidence' })) };
  assert.equal(normalizeReadingQuestions(raw).length, 2);
});

test('malformed restored reading state degrades to trusted questions and valid draft fields', () => {
  const article = DEFAULT_SAMPLE_ARTICLES[0];
  const restored = restoreReadingPractice({ articleVersion: readingArticleVersion(article), questions: {}, answers: [], retellingText: {}, retellingSeconds: '90', completedAt: -1 }, article);
  assert.equal(restored.questions.length, 2);
  assert.deepEqual(restored.answers, {});
  assert.equal(restored.retellingText, '');
  assert.equal(restored.retellingSeconds, 0);
  assert.equal(restored.completedAt, 0);
  const questions = builtInReadingQuestions(article);
  assert.equal(readingPracticeEvidence({ questions, answers: Object.fromEntries(questions.map((question) => [question.id, -1])), retellingText: 'A short English retelling is here.', retellingSeconds: 30, quizChecked: true }).complete, false);
});
