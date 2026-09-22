import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../src/services/storage.js';
import { resolveNceReviewMistake } from '../src/services/nceReview.js';

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

test('backup restores NCE exam history and an unfinished answer sheet', () => {
  StorageService.saveNceExams({
    attempts: [{ id: 'attempt-1', unitId: 'unit-1', results: [], submittedAt: 100 }],
    draft: { unitId: 'unit-2', questions: [{ id: 'q-1' }], answers: { 'q-1': 'handbag' }, startedAt: 200, deadline: 500 },
  });
  const backup = StorageService.exportAllData();
  const preview = StorageService.parseBackupPreview(backup);
  assert.equal(preview.nceExamCount, 1);
  assert.equal(preview.hasNceDraft, true);
  localStorage.clear();
  assert.equal(StorageService.importAllData(backup).success, true);
  assert.equal(StorageService.getNceExams().attempts.length, 1);
  assert.equal(StorageService.getNceExams().draft.answers['q-1'], 'handbag');
  assert.equal(StorageService.importAllData(backup).success, true);
  assert.equal(StorageService.getNceExams().attempts.length, 1);
});

test('backup restores the review queue after resolving one mistake', () => {
  const progress = {
    '001&002.Excuse Me': {
      status: 'learning',
      examMistakes: [
        { id: 'q-1', question: '句子一', answer: 'handbag' },
        { id: 'q-2', question: '句子二', answer: 'umbrella' },
      ],
      dictationMistakes: [{ id: 'd-1', text: 'Excuse me!' }],
    },
  };
  const next = resolveNceReviewMistake(progress, {
    unitId: '001&002.Excuse Me', field: 'examMistakes', mistakeId: 'q-1',
  });
  StorageService.saveNceProgress(next);
  const backup = StorageService.exportAllData();
  localStorage.clear();
  assert.equal(StorageService.importAllData(backup).success, true);
  const restored = StorageService.getNceProgress()['001&002.Excuse Me'];
  assert.deepEqual(restored.examMistakes.map((item) => item.id), ['q-2']);
  assert.equal(restored.dictationMistakes[0].id, 'd-1');
});
