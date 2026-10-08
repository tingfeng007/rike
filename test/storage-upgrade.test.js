import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../src/services/storage.js';
import { readDictionaryState, rememberDictionaryEntry } from '../src/services/dictionary.js';
import { mergeStorageSnapshots } from '../src/services/storageMerge.js';

function memoryStorage() {
  const values = new Map();
  const failed = new Set();
  return { failed, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { if (failed.has(key)) throw new DOMException('quota', 'QuotaExceededError'); values.set(key, String(value)); }, removeItem: (key) => values.delete(key), key: (index) => [...values.keys()][index], get length() { return values.size; } };
}
test.beforeEach(() => { globalThis.localStorage = memoryStorage(); });

test('collecting the first real word does not enroll the demonstration deck', () => {
  assert.equal(StorageService.isUsingSampleVocabulary(), true);
  assert.ok(StorageService.getVocabulary().length > 1);
  assert.ok(StorageService.addWord({word:'intentional',translation:'有意的'}));
  assert.deepEqual(StorageService.getVocabulary().map((item)=>item.word), ['intentional']);
});

test('complete restore preserves grammar, reading, dictionary and real async learning domains', async () => {
  StorageService.saveVocabulary([]); StorageService.saveArticles([]);
  StorageService.saveGrammarProgress({ answers: { simple: { correct: 1, total: 1 } }, totalAnswered: 1, totalCorrect: 1, accuracy: 100 });
  StorageService.saveArticleReadState({ a: { readAt: 123, percent: 100 } });
  StorageService.saveOnboardingState({ demoNoticeSeen: 123 });
  rememberDictionaryEntry({ word: 'audit', translation: 'review', meanings: [{ pos: 'n.', text: 'review' }], forms: [] });
  assert.equal(await StorageService.saveLearningSession('oral:daily', { draft: 'hello' }), true);
  assert.equal(await StorageService.saveReadingEvidence('a', { retellingText: 'Evidence' }), true);
  assert.equal(await StorageService.saveOralCorrections([{ id: 'c1', original: 'He go', corrected: 'He goes' }]), true);
  const backup = StorageService.exportAllData(); globalThis.localStorage = memoryStorage();
  assert.equal((await StorageService.importAllDataAsync(backup)).success, true);
  assert.equal(StorageService.getGrammarProgress().totalAnswered, 1);
  assert.equal(StorageService.getArticleProgress('a').percent, 100);
  assert.equal(StorageService.hasSeenOnboarding('demoNoticeSeen'), true);
  assert.deepEqual(readDictionaryState().history, ['audit']);
  assert.equal(StorageService.getLearningSession('oral:daily').draft, 'hello');
  assert.equal(StorageService.getReadingEvidence('a').retellingText, 'Evidence');
  assert.equal(StorageService.getOralCorrections()[0].corrected, 'He goes');
  assert.equal(StorageService.getVocabulary().length, 0);
  assert.equal(StorageService.getArticles().length, 0);
});

test('connection restore is opt-in and never binds an old key to a new origin', () => {
  StorageService.saveSettings({ provider: 'deepseek', apiKey: 'TEST_ONLY', baseUrl: 'https://api.deepseek.com', speechApiKey: 'TEST_SPEECH', speechBaseUrl: 'https://api.openai.com/v1' });
  const backup = JSON.stringify({ app: 'LingoFlow', version: 4, settings: { baseUrl: 'https://different.example/v1', speechBaseUrl: 'https://other.example/v1', apiKey: '', speechApiKey: '', voiceRate: 0.8 } });
  assert.equal(StorageService.importAllData(backup).success, true);
  assert.equal(StorageService.getSettings().baseUrl, 'https://api.deepseek.com');
  assert.equal(StorageService.getSettings().apiKey, 'TEST_ONLY');
  assert.equal(StorageService.getSettings().voiceRate, 0.8);
  assert.equal(StorageService.parseBackupPreview(backup).connectionChanges.length, 2);
  assert.equal(StorageService.importAllData(backup, { includeConnections: true }).success, true);
  assert.equal(StorageService.getSettings().apiKey, '');
  assert.equal(StorageService.getSettings().speechApiKey, '');
});

test('successful unrelated writes do not dismiss a failed domain, including reload', () => {
  localStorage.failed.add('lingoflow_vocabulary');
  assert.equal(StorageService.saveVocabulary([{ word: 'failed' }]), false);
  assert.equal(StorageService.saveAppState({ activeTab: 'settings' }), true);
  assert.equal(StorageService.getLastWriteError('lingoflow_vocabulary').quotaExceeded, true);
  localStorage.failed.delete('lingoflow_vocabulary');
  assert.equal(StorageService.saveVocabulary([]), true);
  assert.equal(StorageService.getLastWriteError('lingoflow_vocabulary'), null);
});

test('stale whole-deck writes preserve remote additions and unrelated edits', () => {
  StorageService.saveVocabulary([{ id: 'a', word: 'alpha', translation: 'before', userNote: '' }]);
  const stale = StorageService.getVocabulary();
  localStorage.setItem('lingoflow_vocabulary', JSON.stringify([{ id: 'a', word: 'alpha', translation: 'remote', userNote: '' }, { id: 'b', word: 'beta' }]));
  stale[0].userNote = 'local note';
  assert.equal(StorageService.saveVocabulary(stale), true);
  const saved = StorageService.getVocabulary();
  assert.equal(saved.length, 2);
  assert.equal(saved[0].translation, 'remote');
  assert.equal(saved[0].userNote, 'local note');
});

test('concurrent scalar conflicts are recorded and deletes respect remote edits', () => {
  const conflicts = [];
  const merged = mergeStorageSnapshots([{ id: 'a', note: 'old' }], [{ id: 'a', note: 'local' }], [{ id: 'a', note: 'remote' }], (conflict) => conflicts.push(conflict));
  assert.equal(merged[0].note, 'local'); assert.equal(conflicts[0].remote, 'remote');
  assert.deepEqual(mergeStorageSnapshots([{ id: 'a', note: 'old' }], [], [{ id: 'a', note: 'remote' }]), [{ id: 'a', note: 'remote' }]);
});

test('failed async-domain restore rolls back the synchronous backup domains', async () => {
  StorageService.saveVocabulary([{ id: 'a', word: 'kept' }]);
  localStorage.failed.add('lingoflow_sessions_v1');
  const result = await StorageService.importAllDataAsync(JSON.stringify({ app: 'LingoFlow', version: 4, vocabulary: [{ id: 'b', word: 'incoming' }], sessions: { oral: { draft: 'unsaved' } } }));
  assert.equal(result.success, false);
  assert.deepEqual(StorageService.getVocabulary().map((word) => word.word), ['kept']);
  assert.equal(StorageService.getLastWriteError('lingoflow_sessions_v1').quotaExceeded, true);
});

test('storage-event recovery converges after interleaved tab writes', () => {
  const listeners = new Map();
  globalThis.window = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name), dispatchEvent: () => {} };
  const dispose = StorageService.startCrossTabSync();
  try {
    StorageService.saveVocabulary([{ id: 'a', word: 'alpha', translation: 'base' }]);
    StorageService.updateWord('a', { userNote: 'local change' });
    localStorage.setItem('lingoflow_vocabulary', JSON.stringify([{ id: 'a', word: 'alpha', translation: 'base' }, { id: 'b', word: 'beta', translation: 'remote addition' }]));
    listeners.get('storage')({ key: 'lingoflow_vocabulary', storageArea: localStorage });
    const result = StorageService.getVocabulary();
    assert.equal(result.length, 2);
    assert.equal(result[0].userNote, 'local change');
    assert.equal(result[1].translation, 'remote addition');
  } finally { dispose(); delete globalThis.window; }
});

test('an older backup does not replace newer local learning evidence', async () => {
  await StorageService.saveReadingEvidence('a', { retellingText: 'new evidence' });
  const result = await StorageService.importAllDataAsync(JSON.stringify({ app: 'LingoFlow', version: 4, readingEvidence: { a: { retellingText: 'old evidence', updatedAt: 1 } } }));
  assert.equal(result.success, true);
  assert.equal(StorageService.getReadingEvidence('a').retellingText, 'new evidence');
});
