import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreVocabularySession, matchesVocabularySpelling, keyedVocabularyText } from '../src/services/vocabularySession.js';

const savedWord = { id: 'stored', word: 'contract', translation: '合同', phonetic: '/ipa/', reviewCount: 8, tags: ['商务英语'] };
test('restored vocabulary sessions validate enums, cards, bounds and use current stored word edits', () => {
  const restored = restoreVocabularySession({ activeTab: 'invalid', selectedCategory: 'missing', dueCards: [null, { ...savedWord, translation: 'old' }, { id: 'deleted', word: 'old' }], currentIndex: 900, learningMode: 'invalid', selectedLevel: 'invalid', isFlipped: 'true' }, { vocabulary: [savedWord] });
  assert.equal(restored.activeTab, 'flashcard');
  assert.equal(restored.selectedCategory, 'personal');
  assert.equal(restored.selectedLevel, 'all');
  assert.equal(restored.learningMode, 'recall');
  assert.equal(restored.currentIndex, 0);
  assert.equal(restored.dueCards.length, 1);
  assert.equal(restored.dueCards[0].translation, '合同');
  assert.equal(restored.dueCards[0].reviewCount, 8);
  assert.equal(restored.isFlipped, false);
  assert.deepEqual(restoreVocabularySession({ dueCards: {} }).dueCards, []);
});

test('category exploration restores temporary words without collecting and bounds requeues', () => {
  const word = { id: 'explore:business:colleague', word: 'colleague', translation: '同事', tags: {} };
  const result = restoreVocabularySession({ selectedCategory: 'business', selectedLevel: 'starter', dueCards: [word, word, word], currentIndex: 1, learningMode: 'spelling', spellingAnswer: 'colleage', spellingChecked: true, isFlipped: true });
  assert.equal(result.dueCards.length, 2);
  assert.deepEqual(result.dueCards[0].tags, []);
  assert.deepEqual(result.requeuedIds, [word.id]);
  assert.equal(result.currentIndex, 1);
  assert.equal(result.isFlipped, true);
  assert.equal(result.selectedLevel, 'starter');
  assert.equal(restoreVocabularySession({ ...result, spellingChecked: false }).isFlipped, false);
});

test('spelling compares full phrases and handles case, apostrophes and whitespace consistently', () => {
  assert.equal(matchesVocabularySpelling('  Check   IN ', 'check in'), true);
  assert.equal(matchesVocabularySpelling('don’t', "don't"), true);
  assert.equal(matchesVocabularySpelling('colleage', 'colleague'), false);
  assert.equal(matchesVocabularySpelling('', ''), false);
});

test('restored sessions retain the next valid cursor and reject unfinished spelling reveals', () => {
  const next = { ...savedWord, id: 'next', word: 'budget' };
  const restored = restoreVocabularySession({ dueCards: [savedWord, { id: 'removed' }, next], currentIndex: 2, learningMode: 'spelling', spellingAnswer: ['contract'], spellingChecked: true, isFlipped: true, requeuedIds: ['missing', next.id], reviewCompleted: 'true' }, { vocabulary: [savedWord, next] });
  assert.equal(restored.currentIndex, 1);
  assert.equal(restored.dueCards[restored.currentIndex].word, 'budget');
  assert.equal(restored.spellingAnswer, '');
  assert.equal(restored.spellingChecked, false);
  assert.equal(restored.isFlipped, false);
  assert.equal(restored.reviewCompleted, false);
  assert.deepEqual(restored.requeuedIds, [next.id]);
});

test('content keys distinguish duplicate paragraphs and survive inserting unrelated text', () => {
  const before = keyedVocabularyText(['One paragraph.', 'Repeated.', 'Repeated.']);
  const after = keyedVocabularyText(['New paragraph.', 'One paragraph.', 'Repeated.', 'Repeated.']);
  assert.deepEqual(before.map((entry) => entry.key), after.slice(1).map((entry) => entry.key));
  assert.notEqual(before[1].key, before[2].key);
  assert.deepEqual(before.map((entry) => entry.index), [0, 1, 2]);
});
