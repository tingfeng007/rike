import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExercises, extractWords, parseLrc, safeAssetName } from '../src/services/nce.js';

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
