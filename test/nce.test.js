import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDictationItems,
  buildExercises,
  extractWords,
  parseLrc,
  safeAssetName,
  scoreDictation,
} from '../src/services/nce.js';
import { buildNceExamQuestions, gradeNceExam } from '../src/services/nceExam.js';

const SAMPLE_LRC = `[00:01.50]Excuse me! | 打扰一下！
[00:03.00]Is this your handbag? | 这是你的手提包吗？
[00:05.25]Thank you very much. | 非常感谢。`;

test('parseLrc parses timestamps and bilingual text', () => {
  const lines = parseLrc(SAMPLE_LRC);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].time, 1.5);
  assert.equal(lines[1].zh, '这是你的手提包吗？');
});

test('buildExercises masks answers and distributes correct choice positions', () => {
  const lines = parseLrc(`${SAMPLE_LRC}\n[00:08.00]Listen to the tape then answer this question. | 听录音，然后回答问题。`);
  const exercises = buildExercises(lines, 5);
  assert.ok(exercises.length >= 1);
  assert.ok(exercises.every((exercise) => exercise.sentence.includes('_____')));
  const choices = exercises.filter((exercise) => exercise.type === 'choice');
  const correctIndexes = choices.map((choice) => {
    const matches = choice.options.filter((item) => item.toLowerCase() === choice.answer);
    assert.equal(matches.length, 1);
    return choice.options.findIndex((item) => item.toLowerCase() === choice.answer);
  });
  assert.ok(correctIndexes.some((index) => index > 0));
});

test('extractWords removes common function words and keeps context', () => {
  const words = extractWords(parseLrc(SAMPLE_LRC));
  assert.equal(words.some((item) => item.word === 'this'), false);
  assert.equal(words.some((item) => item.word === 'handbag'), true);
  assert.ok(words.find((item) => item.word === 'handbag').sentence.includes('handbag'));
});

test('safeAssetName encodes filenames for remote assets', () => {
  assert.equal(safeAssetName('001&002.Excuse Me'), '001%26002.Excuse%20Me');
});

test('scoreDictation ignores case and punctuation while exposing missing words', () => {
  const perfect = scoreDictation('Is this your handbag?', 'is this your handbag');
  assert.equal(perfect.score, 100);
  assert.equal(perfect.isPerfect, true);

  const partial = scoreDictation('Thank you very much.', 'thank you much');
  assert.equal(partial.score, 75);
  assert.deepEqual(partial.missingWords, ['very']);
});

test('buildDictationItems excludes course metadata and keeps source line indexes', () => {
  const lines = parseLrc(`[00:00.00]Lesson 1 | 第1课
[00:01.00]Listen to the tape then answer this question. | 听录音，然后回答问题。
${SAMPLE_LRC}`);
  const items = buildDictationItems(lines);
  assert.equal(items.length, 3);
  assert.equal(items[0].text, 'Excuse me!');
  assert.equal(items[0].lineIndex, 2);
});

test('NCE exam generates distinct choices and fill questions from lesson lines', () => {
  const lines = parseLrc(`[00:00.00]Lesson 1 | 第1课
[00:01.00]Listen to the tape then answer this question. | 听录音
[00:03.00]Is this your handbag? | 这是你的手提包吗？
[00:05.00]Thank you very much. | 非常感谢。
[00:07.00]Whose handbag is it? | 这是谁的手提包？
[00:09.00]Yes, it is my handbag. | 是的，这是我的手提包。
[00:11.00]Is this your handbag? | 这是你的手提包吗？
[00:12.00]Pardon? | 抱歉？`);
  const questions = buildNceExamQuestions(lines, 'unit-1', 8);
  assert.ok(questions.some((item) => item.type === 'choice'));
  assert.ok(questions.some((item) => item.type === 'fill'));
  assert.ok(questions.every((item) => !item.question.startsWith('Listen to the tape')));
  assert.equal(new Set(questions.map((item) => item.id)).size, questions.length);
  questions.filter((item) => item.type === 'choice').forEach((item) => {
    assert.equal(new Set(item.options).size, item.options.length);
    assert.equal(item.options.filter((option) => option === item.answer).length, 1);
  });
  questions.filter((item) => item.type === 'fill').forEach((item) => {
    assert.ok(item.question.includes('______'));
    assert.notEqual(item.question, item.source);
    assert.notEqual(item.source, 'Pardon?');
  });
  assert.deepEqual(questions, buildNceExamQuestions(lines, 'unit-1', 8));
});

test('NCE exam grades unanswered items and ignores case and punctuation', () => {
  const questions = [
    { id: 'choice', type: 'choice', answer: 'Thank you very much.' },
    { id: 'fill', type: 'fill', answer: 'Handbag' },
    { id: 'empty', type: 'fill', answer: 'umbrella' },
  ];
  const result = gradeNceExam(questions, { choice: 'thank you very much', fill: 'handbag!' });
  assert.equal(result.correct, 2);
  assert.equal(result.unanswered, 1);
  assert.equal(result.score, 67);
  assert.equal(result.results[2].isCorrect, false);
  assert.equal(gradeNceExam(questions, {}).score, 0);
});
