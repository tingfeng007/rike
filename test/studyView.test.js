import test from 'node:test';
import assert from 'node:assert/strict';
import { filterVocabulary, getReadingMetrics } from '../src/services/studyView.js';

test('reading metrics handle empty text and estimate by word count', () => {
  assert.deepEqual(getReadingMetrics(''), { wordCount: 0, minutes: 0 });
  const content = Array.from({ length: 181 }, (_, index) => `word${index}`).join(' ');
  assert.deepEqual(getReadingMetrics(content), { wordCount: 181, minutes: 2 });
});

test('vocabulary search includes notes, context and tags', () => {
  const words = [
    { word: 'handbag', translation: '', contextSentence: 'Whose handbag is it?', userNote: '', tags: ['新概念英语'], status: 'learning' },
    { word: 'resilience', translation: '韧性', contextSentence: 'Stay strong.', userNote: 'bounce back', tags: ['心智'], status: 'review' },
  ];
  assert.deepEqual(filterVocabulary(words, 'whose').map((item) => item.word), ['handbag']);
  assert.deepEqual(filterVocabulary(words, 'bounce back').map((item) => item.word), ['resilience']);
  assert.deepEqual(filterVocabulary(words, '新概念').map((item) => item.word), ['handbag']);
});

test('needs-meaning filter only returns words without a translation', () => {
  const words = [
    { word: 'handbag', translation: ' ', status: 'learning' },
    { word: 'resilience', translation: '韧性', status: 'review' },
  ];
  assert.deepEqual(filterVocabulary(words, '', 'needsMeaning').map((item) => item.word), ['handbag']);
  assert.deepEqual(filterVocabulary(words, '', 'review').map((item) => item.word), ['resilience']);
});

test('hard-word filter and source labels stay searchable', () => {
  const words = [
    { word: 'handbag', translation: '手提包', tags: ['困难词'], sources: [{ label: 'Excuse Me' }], easeFactor: 1.5 },
    { word: 'resilience', translation: '韧性', tags: ['心智'], sources: [{ label: '精读文章' }], easeFactor: 2.5 },
  ];
  assert.deepEqual(filterVocabulary(words, '', 'hard').map((item) => item.word), ['handbag']);
  assert.deepEqual(filterVocabulary(words, 'Excuse Me').map((item) => item.word), ['handbag']);
});
