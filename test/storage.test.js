import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../src/services/storage.js';

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
}

test.beforeEach(() => {
  globalThis.localStorage = createMemoryStorage();
});

test('adding an existing word preserves SRS mastery and merges source tags', () => {
  StorageService.saveVocabulary([{
    id: 'known_word',
    word: 'handbag',
    translation: '手提包',
    status: 'mastered',
    step: 6,
    reviewCount: 12,
    intervalDays: 30,
    nextReviewDate: 999999,
    createdAt: 100,
    tags: ['个人词库'],
  }]);

  const merged = StorageService.addWord({
    word: 'handbag',
    translation: '',
    contextSentence: 'Is this your handbag?',
    tags: ['新概念英语', '第一册'],
  });

  assert.equal(merged.status, 'mastered');
  assert.equal(merged.reviewCount, 12);
  assert.equal(merged.createdAt, 100);
  assert.equal(merged.translation, '手提包');
  assert.deepEqual(merged.tags, ['个人词库', '新概念英语', '第一册']);
});

test('backup includes and restores NCE progress', () => {
  StorageService.saveNceProgress({ lesson_1: { status: 'completed', lastStudiedAt: 123 } });
  const backup = StorageService.exportAllData();
  localStorage.clear();
  const result = StorageService.importAllData(backup);

  assert.equal(result.success, true);
  assert.equal(StorageService.getNceProgress().lesson_1.status, 'completed');
});
