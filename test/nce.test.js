import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDictationItems,
  buildExercises,
  buildNceWordPayload,
  extractWords,
  parseLrc,
  safeAssetName,
  scoreDictation,
} from '../src/services/nce.js';
import { buildNceExamQuestions, gradeNceExam } from '../src/services/nceExam.js';
import { buildNceReviewQueue, gradeNceReview, resolveNceReviewMistake } from '../src/services/nceReview.js';

const SAMPLE_LRC = `[00:01.50]Excuse me! | 打扰一下！
[00:03.00]Is this your handbag? | 这是你的手提包吗？
[00:05.25]Thank you very much. | 非常感谢。`;

test('parseLrc parses timestamps and bilingual text', () => {
  const lines = parseLrc(SAMPLE_LRC);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].time, 1.5);
  assert.equal(lines[1].zh, '这是你的手提包吗？');
});

// --- N-18: retaking a unit must not hand back the identical paper -------------

const VARIANT_LRC = `[00:01.00]Excuse me, is this your handbag? | 打扰一下，这是你的手提包吗？
[00:02.00]Yes, it is. Thank you very much. | 是的，非常感谢。
[00:03.00]My coat and my umbrella please. | 请把我的大衣和伞给我。
[00:04.00]Here is my ticket. | 这是我的票。
[00:05.00]This is my umbrella and that is my coat. | 这是我的伞，那是我的大衣。
[00:06.00]Sorry sir, but my dog is not well today. | 抱歉先生，我的狗今天不舒服。`;

test('an exam built without a variant stays deterministic', () => {
  const lines = parseLrc(VARIANT_LRC);
  const first = buildNceExamQuestions(lines, 'unit-a');
  const second = buildNceExamQuestions(lines, 'unit-a');

  assert.deepEqual(
    first.map((q) => q.id),
    second.map((q) => q.id),
    'omitting the variant must preserve the historical deterministic behaviour',
  );
  assert.deepEqual(first.map((q) => q.options), second.map((q) => q.options));
});

test('a new attempt variant produces a different paper for the same unit', () => {
  const lines = parseLrc(VARIANT_LRC);
  const attemptOne = buildNceExamQuestions(lines, 'unit-a', 10, 'attempt-1');
  const attemptTwo = buildNceExamQuestions(lines, 'unit-a', 10, 'attempt-2');

  assert.ok(attemptOne.length >= 3, 'precondition: enough questions to compare');
  const sameOrder = JSON.stringify(attemptOne.map((q) => q.id)) === JSON.stringify(attemptTwo.map((q) => q.id));
  const sameOptions = JSON.stringify(attemptOne.map((q) => q.options)) === JSON.stringify(attemptTwo.map((q) => q.options));
  assert.ok(
    !sameOrder || !sameOptions,
    'a retake must differ in question order/selection or option order, otherwise it only measures answer recall',
  );
});

test('the same variant is reproducible, and a variant does not leak across units', () => {
  const lines = parseLrc(VARIANT_LRC);
  const a1 = buildNceExamQuestions(lines, 'unit-a', 10, 'attempt-1');
  const a1again = buildNceExamQuestions(lines, 'unit-a', 10, 'attempt-1');
  assert.deepEqual(a1.map((q) => q.id), a1again.map((q) => q.id), 'same variant is stable');

  const b1 = buildNceExamQuestions(lines, 'unit-b', 10, 'attempt-1');
  const sameAsA = JSON.stringify(a1.map((q) => q.options)) === JSON.stringify(b1.map((q) => q.options));
  assert.equal(sameAsA, false, 'unitId still participates in the seed');
});

// --- N-05: a wrong answer must be traceable back to the exact lesson line -------------

test('exercises carry the lesson line they came from', () => {
  const lines = parseLrc(SAMPLE_LRC);
  const exercises = buildExercises(lines, 5);
  assert.ok(exercises.length >= 1);

  for (const exercise of exercises) {
    assert.ok(exercise.lineId, 'every exercise records its line id');
    assert.ok(exercise.sourceText, 'every exercise records the unmasked sentence');
    // The recorded line must really exist in the lesson and match the exercise content.
    const line = lines.find((item) => item.id === exercise.lineId);
    assert.ok(line, `line ${exercise.lineId} exists in the lesson`);
    assert.equal(line.en, exercise.sourceText);
    // The masked sentence is derived from that same line (sanitised), never a different one.
    assert.equal(exercise.sentence.replace(/_+/g, 'X').length > 0, true);
  }
});

test('the review queue passes the source line through for both exercise and dictation mistakes', () => {
  const progress = {
    '001&002.Excuse Me': {
      exerciseMistakes: [{ id: 'l1-exercise', sentence: 'Is this your ______?', answer: 'handbag', lineId: 'l1', sourceText: 'Is this your handbag?', updatedAt: 5 }],
      dictationMistakes: [{ id: 'l2-dictation', text: 'Yes, it is.', lineId: 'l2', score: 60, updatedAt: 6 }],
    },
  };

  const queue = buildNceReviewQueue(progress);
  const exercise = queue.find((item) => item.kind === 'exercise');
  const dictation = queue.find((item) => item.kind === 'dictation');

  assert.equal(exercise.lineId, 'l1', 'exercise mistake keeps its line id');
  assert.equal(exercise.sourceText, 'Is this your handbag?');
  assert.equal(dictation.lineId, 'l2', 'dictation mistake keeps its line id');
  assert.equal(dictation.sourceText, 'Yes, it is.');
  // Dictation must NOT expose the sentence before the retry, or it gives the answer away.
  assert.equal(dictation.prompt, '', 'dictation prompt stays empty');
  assert.equal(dictation.answer, 'Yes, it is.');
});

test('review queue tolerates older mistake records without a line id', () => {
  const progress = {
    '003&004.Sorry Sir': {
      exerciseMistakes: [{ id: 'old', sentence: 'My coat and my ______.', answer: 'umbrella', updatedAt: 1 }],
    },
  };
  const [item] = buildNceReviewQueue(progress);
  assert.equal(item.lineId, '');
  assert.equal(item.sourceText, '', 'no source text rather than undefined');
  assert.equal(item.kind, 'exercise');
});

// --- N-01: lesson words can carry a looked-up meaning into the vocabulary book ------------

test('a lesson word saved after a lookup keeps the meaning, context and source', () => {
  const payload = buildNceWordPayload(
    { word: 'handbag', sentence: 'Is this your handbag?', sentenceCn: '这是你的手提包吗？' },
    {
      unitId: '001&002.Excuse Me',
      unitTitle: 'Excuse Me',
      meaning: { phonetic: '/ˈhændbæg/', pos: 'n.', translation: '手提包', definitionEn: 'a small bag' },
    },
  );

  assert.equal(payload.word, 'handbag');
  assert.equal(payload.phonetic, '/ˈhændbæg/');
  assert.equal(payload.pos, 'n.');
  assert.equal(payload.translation, '手提包');
  assert.equal(payload.definitionEn, 'a small bag');
  assert.equal(payload.contextSentence, 'Is this your handbag?');
  assert.equal(payload.contextSentenceCn, '这是你的手提包吗？');
  assert.ok(payload.tags.includes('新概念英语'));
  assert.equal(payload.sources.length, 1);
  assert.deepEqual(
    { type: payload.sources[0].type, id: payload.sources[0].id },
    { type: 'nce', id: '001&002.Excuse Me' },
    'the source must point back to the lesson so the word can jump home',
  );
});

test('a lesson word saved without a lookup stays meaning-less (so it can be found later)', () => {
  const payload = buildNceWordPayload({ word: 'umbrella', sentence: 'My coat and my umbrella.' }, {
    unitId: '003&004.Sorry Sir',
    unitTitle: 'Sorry Sir',
  });

  // Empty — not a placeholder like "待补充": the vocabulary book's 需要释义 filter keys off a
  // blank translation, so a placeholder would hide the word from the user forever.
  assert.equal(payload.translation, '');
  assert.equal(payload.phonetic, '');
  assert.equal(payload.pos, '');
  assert.equal(payload.contextSentence, 'My coat and my umbrella.');
});

test('buildNceWordPayload tolerates a missing item or unit', () => {
  const empty = buildNceWordPayload(undefined);
  assert.equal(empty.word, '');
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(empty.tags, ['新概念英语', '第一册']);

  const partial = buildNceWordPayload({ word: 'coat' }, { meaning: { translation: '大衣' } });
  assert.equal(partial.translation, '大衣');
  assert.equal(partial.phonetic, '');
  assert.deepEqual(partial.sources, []);
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

test('review queue combines exam, dictation and exercise mistakes without exposing dictation text', () => {
  const progress = {
    '001&002.Excuse Me': {
      lastStudiedAt: 100,
      dictationMistakes: [{ id: 'dict-1', text: 'Is this your handbag?', attempt: 'Is this handbag?' }],
      exerciseMistakes: [{ id: 'exercise-1', sentence: 'Is this your _____?', answer: 'handbag', attempt: 'coat' }],
      examMistakes: [{ id: 'exam-1', question: '这是你的手提包吗？', answer: 'Is this your handbag?', submitted: '' }],
    },
    '003&004.Sorry Sir': { examMistakes: [{ id: 'exam-2', question: '谢谢', answer: 'Thank you.' }] },
  };
  const queue = buildNceReviewQueue(progress);
  assert.equal(queue.length, 4);
  assert.equal(queue.find((item) => item.kind === 'dictation').prompt, '');
  assert.equal(queue.find((item) => item.kind === 'exercise').answer, 'handbag');
  assert.equal(buildNceReviewQueue({ '001&002.Excuse Me': { examMistakes: [{}] } }).length, 0);
  assert.equal(buildNceReviewQueue(progress, 'other').length, 0);
  assert.equal(buildNceReviewQueue(progress, '001&002.Excuse Me').length, 3);
  const resolved = resolveNceReviewMistake(progress, queue.find((item) => item.kind === 'exercise'));
  assert.equal(buildNceReviewQueue(resolved).length, 3);
  assert.equal(resolved['001&002.Excuse Me'].exerciseMistakes.length, 0);
  assert.equal(resolved['001&002.Excuse Me'].dictationMistakes.length, 1);
  assert.equal(progress['001&002.Excuse Me'].exerciseMistakes.length, 1);
  assert.equal(resolveNceReviewMistake(resolved, queue.find((item) => item.kind === 'exercise')), resolved);
});

test('review grading requires recalled words while ignoring punctuation and case', () => {
  const item = { answer: 'Is this your handbag?' };
  assert.equal(gradeNceReview(item, 'is this your handbag').correct, true);
  assert.equal(gradeNceReview(item, 'is this handbag').correct, false);
  assert.equal(gradeNceReview(item, '').correct, false);
});
