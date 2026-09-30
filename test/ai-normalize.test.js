import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVocabularyQuiz,
  normalizeVocabStory,
  normalizeArticle,
  normalizeWordAnalysis,
  normalizeSentenceAnalysis,
} from '../src/services/ai.js';

/**
 * Regression tests for V-05: `extractJson` only proved the reply *parsed*, so a model that
 * omitted `options` / `correctIndex` / `storyEn` crashed the consuming component — the
 * vocabulary page even took the ErrorBoundary down, and an out-of-range `correctIndex`
 * marked a correct answer wrong *and* reset the word's SRS scheduling.
 */

// --- quiz -------------------------------------------------------------------

test('a well formed quiz passes through unchanged in shape', () => {
  const quiz = normalizeVocabularyQuiz({
    questions: [{
      id: 1,
      targetWord: 'handbag',
      sentenceWithBlank: 'Is this your ____?',
      sentenceCn: '这是你的手提包吗？',
      options: ['handbag', 'umbrella', 'coat', 'ticket'],
      correctIndex: 0,
      explanation: 'handbag = 手提包',
    }],
  });

  assert.equal(quiz.questions.length, 1);
  const [q] = quiz.questions;
  assert.equal(q.targetWord, 'handbag');
  assert.equal(q.correctIndex, 0);
  assert.equal(q.options.length, 4);
});

test('questions with unusable options or index are dropped, not crashed on', () => {
  const quiz = normalizeVocabularyQuiz({
    questions: [
      { id: 1, options: ['only-one'], correctIndex: 0 },                       // <2 options
      { id: 2, options: ['a', 'b'], correctIndex: 9 },                         // index out of range, no answer to recover from
      { id: 3, options: ['a', 'b'], correctIndex: -1 },
      null,
      'not an object',
      { id: 4, options: ['good', 'bad'], correctIndex: 1 },                    // valid
    ],
  });

  assert.equal(quiz.questions.length, 1);
  assert.equal(quiz.questions[0].id, '4');
});

test('an out of range correctIndex is recovered from the answer text', () => {
  const quiz = normalizeVocabularyQuiz({
    questions: [{
      id: 'q1',
      targetWord: 'coat',
      options: ['ticket', 'coat'],
      correctIndex: 7,
      answer: 'coat',
    }],
  });
  assert.equal(quiz.questions[0].correctIndex, 1, 'falls back to the matching option');
});

test('missing or duplicate ids are made unique and usable as answer keys', () => {
  const quiz = normalizeVocabularyQuiz({
    questions: [
      { options: ['a', 'b'], correctIndex: 0 },
      { options: ['a', 'b'], correctIndex: 0 },
      { id: 'dup', options: ['a', 'b'], correctIndex: 0 },
      { id: 'dup', options: ['a', 'b'], correctIndex: 0 },
    ],
  });
  const ids = quiz.questions.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique for the score map');
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
});

test('a quiz with no usable question raises one readable error', () => {
  assert.throws(() => normalizeVocabularyQuiz({ questions: [] }), /测验/);
  assert.throws(() => normalizeVocabularyQuiz(null), /测验/);
  assert.throws(() => normalizeVocabularyQuiz({ unexpected: true }), /测验/);
});

test('a bare array of questions is accepted', () => {
  const quiz = normalizeVocabularyQuiz([{ options: ['a', 'b'], correctIndex: 0 }]);
  assert.equal(quiz.questions.length, 1);
});

// --- story ------------------------------------------------------------------

test('a story without a body raises a readable error instead of a TypeError later', () => {
  assert.throws(() => normalizeVocabStory({ title: 'No body' }), /故事正文/);
  assert.throws(() => normalizeVocabStory(null), /故事正文/);
});

test('a story is normalized to the fields the UI reads', () => {
  const story = normalizeVocabStory({ storyEn: 'A tale.', title: 'T', titleCn: '题' }, { genre: 'mystery' });
  assert.equal(story.storyEn, 'A tale.');
  assert.equal(story.storyCn, '');
  assert.deepEqual(story.usedWords, []);
  assert.equal(story.genre, 'mystery');
});

// --- article ----------------------------------------------------------------

test('an article without content raises a readable error', () => {
  assert.throws(() => normalizeArticle({ title: 'Empty' }), /文章正文/);
  assert.throws(() => normalizeArticle([]), /文章正文/);
});

test('an article falls back to sensible defaults', () => {
  const article = normalizeArticle({ content: 'Body text' });
  assert.equal(article.content, 'Body text');
  assert.equal(article.title, 'AI 精选外刊');
  assert.deepEqual(article.tags, []);
});

// --- word / sentence analysis ----------------------------------------------

test('word analysis never yields undefined fields for the renderer', () => {
  const analysis = normalizeWordAnalysis({ translation: '手提包' }, { word: 'handbag', sentence: 'Is this your handbag?' });
  for (const field of ['word', 'phonetic', 'pos', 'translation', 'definitionEn', 'contextSentence', 'contextSentenceCn']) {
    assert.equal(typeof analysis[field], 'string', `${field} must be a string`);
  }
  assert.deepEqual(analysis.collocations, []);
  assert.equal(analysis.contextSentence, 'Is this your handbag?', 'falls back to the tapped sentence');
});

test('word analysis of garbage input does not throw', () => {
  assert.doesNotThrow(() => normalizeWordAnalysis(null));
  assert.doesNotThrow(() => normalizeWordAnalysis('a string'));
  assert.doesNotThrow(() => normalizeWordAnalysis([1, 2, 3]));
});

test('sentence analysis normalizes clauses and grammar points', () => {
  const analysis = normalizeSentenceAnalysis({
    clauses: [{ type: '主语', text: 'This', explanation: '指代' }, null, { type: 5 }],
    grammarPoints: ['定语从句', 42, ''],
  }, { sentence: 'This is the book that I bought.' });

  assert.equal(analysis.clauses.length, 2, 'null clause rows are dropped');
  assert.equal(typeof analysis.clauses[0].type, 'string');
  assert.equal(typeof analysis.clauses[1].text, 'string');
  assert.deepEqual(analysis.grammarPoints, ['定语从句', '42']);
  assert.equal(analysis.sentence, 'This is the book that I bought.');
});
