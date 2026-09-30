import test from 'node:test';
import assert from 'node:assert/strict';
import { VOCABULARY_CATEGORIES, sampleCategoryWords } from '../src/data/categoryVocabulary.js';
import { StorageService } from '../src/services/storage.js';
import { fillCategoryPhonetics } from '../src/data/categoryPhonetics.js';

test('every category has a distinct, usable bilingual starter deck', () => {
  assert.equal(new Set(VOCABULARY_CATEGORIES.map((item) => item.id)).size, 8);
  for (const category of VOCABULARY_CATEGORIES) {
    assert.ok(category.words.length > 10);
    assert.equal(new Set(category.words.map((item) => item.word)).size, category.words.length);
    for (const item of category.words) {
      for (const field of ['word', 'pos', 'translation', 'contextSentence', 'contextSentenceCn', 'phonetic']) {
        assert.ok(item[field]?.trim(), `${category.id}: ${item.word} missing ${field}`);
      }
      assert.ok(!item.translation.includes('?'));
      assert.equal(item.sources[0].id, category.id);
    }
  }
});

test('existing cards get missing IPA without losing progress or replacing custom IPA', () => {
  const prior = [{ id: 'old', word: 'contract', phonetic: '', reviewCount: 12, nextReviewDate: 999999, userNote: 'note' },
    { id: 'custom', word: 'variable', phonetic: '/custom/' }, { id: 'unknown', word: 'my-unlisted-word' }];
  const filled = fillCategoryPhonetics(prior);
  assert.equal(filled[0].phonetic, '/ˈkɑːntrækt/');
  assert.deepEqual({ ...filled[0], phonetic: '' }, prior[0]);
  assert.equal(prior[0].phonetic, '');
  assert.equal(filled[1], prior[1]);
  assert.equal(filled[2], prior[2]);
  assert.deepEqual(fillCategoryPhonetics(filled), filled);
});

test('sampling respects category, limits, and excludes duplicates without changing the deck', () => {
  const original = JSON.stringify(VOCABULARY_CATEGORIES);
  const first = sampleCategoryWords('computing', { random: () => 0.3 });
  const second = sampleCategoryWords('computing', { previousWords: first.map((item) => item.word), random: () => 0.7 });
  assert.equal(first.length, 10);
  assert.equal(new Set(second.map((item) => item.word)).size, 10);
  assert.equal(second.filter((item) => !first.some((prior) => prior.word === item.word)).length, 6);
  assert.ok(second.every((item) => item.sources[0].id === 'computing'));
  assert.deepEqual(sampleCategoryWords('missing'), []);
  assert.deepEqual(sampleCategoryWords('business', { size: 0 }), []);
  assert.equal(sampleCategoryWords('business', { size: 100 }).length, 16);
  assert.equal(JSON.stringify(VOCABULARY_CATEGORIES), original);
});

test('drawing a known category word retains personal edits and the SRS schedule', () => {
  const data = new Map();
  globalThis.localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  StorageService.saveVocabulary([]);
  const word = VOCABULARY_CATEGORIES.find((item) => item.id === 'business').words[0];
  const saved = StorageService.addWord(word);
  StorageService.updateWord(saved.id, { reviewCount: 8, status: 'mastered', nextReviewDate: 9999999999999, userNote: 'my note', translation: '自定义释义' });
  const redrawn = StorageService.addWord(word);
  assert.equal(StorageService.getVocabulary().length, 1);
  assert.equal(redrawn.id, saved.id);
  assert.equal(redrawn.reviewCount, 8);
  assert.equal(redrawn.nextReviewDate, 9999999999999);
  assert.equal(redrawn.translation, '自定义释义');
  assert.equal(redrawn.userNote, 'my note');
});
