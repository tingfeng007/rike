import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAMMAR_LESSONS } from '../src/data/grammarLessons.js';
import { composeLearningSentence, buildGrammarLessonQuiz } from '../src/services/grammarLessons.js';
import { applyGrammarAnswer, gradeGrammarAnswer, summarizeGrammarProgress } from '../src/services/grammar.js';

test('expanded teaching examples have valid parts and every lesson has answerable practice', () => {
  assert.equal(new Set(GRAMMAR_LESSONS.map((item) => item.id)).size, GRAMMAR_LESSONS.length);
  for (const lesson of GRAMMAR_LESSONS) {
    assert.ok(lesson.rules.length >= 4);
    assert.ok(lesson.questions.length >= 8, `${lesson.id} needs transfer practice`);
    assert.ok(new Set(lesson.questions.map((q) => q.type)).size >= 3, `${lesson.id} needs different practice modes`);
    for (const example of lesson.examples) for (const part of example.parts) assert.ok(example.en.includes(part.text), `${lesson.id}: ${part.text}`);
    for (const question of lesson.questions) {
      assert.ok(question.choices[question.answer]);
      assert.equal(new Set(question.choices).size, question.choices.length);
      assert.ok(question.explanation.length >= 20, `${lesson.id} must explain the answer`);
      if (question.highlight) assert.ok(question.prompt.includes(question.highlight));
    }
  }
});
test('sentence expansion keeps frequency before the verb and optional manner-place-time after the object', () => {
  assert.equal(composeLearningSentence().sentence, 'I read a book.');
  assert.equal(composeLearningSentence({ frequency: 'often', manner: 'carefully', place: 'at home', time: 'after dinner' }).sentence, 'I often read a book carefully at home after dinner.');
  assert.equal(composeLearningSentence({ frequency: 'often', time: 'after dinner' }, true).sentence, 'After dinner, I often read a book.');
  assert.equal(composeLearningSentence({ manner: 'malformed', time: 'yesterday' }, true).sentence, 'I read a book.');
});
test('topic exercises are scoped, reproducible and keep a stable identity across shuffled choices', () => {
  const options = { topicIds: ['place-time'], count: 5, seed: 'study' };
  const quiz = buildGrammarLessonQuiz(options);
  assert.deepEqual(quiz, buildGrammarLessonQuiz(options));
  assert.equal(quiz.length, 5);
  assert.ok(quiz.every((q) => q.patternId === 'place-time'));
  for (const q of quiz) {
    assert.ok(q.options.some((option) => gradeGrammarAnswer(q, option.value)));
    assert.equal(q.options.filter((option) => gradeGrammarAnswer(q, option.value)).length, 1);
  }
  const all = buildGrammarLessonQuiz({ ...options, count: 100 });
  assert.deepEqual(new Set(all.map((q) => q.id)), new Set(buildGrammarLessonQuiz({ ...options, count: 100, seed: 'another-run' }).map((q) => q.id)));
});
test('new-topic answers participate in summaries, backup-compatible progress and wrong-answer replay', () => {
  const question = buildGrammarLessonQuiz({ topicIds: ['expansion'], count: 1 })[0];
  let progress = applyGrammarAnswer({}, { patternId: question.patternId, correct: false, questionId: question.id });
  assert.equal(progress.missed[0].questionId, question.id);
  assert.equal(summarizeGrammarProgress(progress).find((item) => item.patternId === 'expansion').total, 1);
  progress = applyGrammarAnswer(progress, { patternId: question.patternId, correct: true, questionId: question.id });
  assert.equal(progress.missed.length, 0);
  assert.equal(progress.totalAnswered, 2);
});
