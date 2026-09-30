import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService, DEFAULT_SAMPLE_WORDS, MAX_INTERVAL_DAYS } from '../src/services/storage.js';
import { filterVocabulary } from '../src/services/studyView.js';

/**
 * Regression tests for the data-safety defects found in the optimisation audit
 * (docs/OPTIMIZATION_DIAGNOSIS_REPORT.md, findings D-01 / D-03 / D-05 / D-06 / D-07 / D-08).
 *
 * Each test pins the behaviour that was previously broken, so the defect cannot come back
 * silently.
 */

function createMemoryStorage({ failKeys = new Set(), maxValueLength = Infinity } = {}) {
  const data = new Map();
  const quotaError = (key) => {
    const error = new Error(`cannot write ${key}`);
    error.name = 'QuotaExceededError';
    return error;
  };
  return {
    failKeys,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (failKeys.has(key)) throw quotaError(key);
      // Models a real quota: only oversized values are rejected, so a rollback of the
      // small keys can still succeed.
      if (String(value).length > maxValueLength) throw quotaError(key);
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
}

let storage;

test('a failed activity event does not leave inflated study counters', () => {
  StorageService.recordStudyActivity({ type: 'review', count: 1 });
  const before = StorageService.getStudyStats();
  const eventsBefore = StorageService.getStudyEvents();
  storage.failKeys.add('lingoflow_study_events_v1');
  assert.equal(StorageService.recordStudyActivity({ type: 'review', count: 8 }), null);
  assert.deepEqual(StorageService.getStudyStats(), before);
  assert.deepEqual(StorageService.getStudyEvents(), eventsBefore);
});

test('article writes report failure and preserve article annotations on failed deletion', () => {
  StorageService.saveArticles([{ id: 'a', title: 'Keep me', content: 'Text' }]);
  StorageService.saveReadingAnnotations({ a: [{ sentence: 'Text' }] });
  storage.failKeys.add('lingoflow_articles');
  assert.equal(StorageService.saveArticle({ id: 'b', content: 'New' }), null);
  assert.equal(StorageService.deleteArticle('a'), null);
  assert.equal(StorageService.getArticles()[0].id, 'a');
  assert.equal(StorageService.getReadingAnnotations().a.length, 1);
});

test.beforeEach(() => {
  storage = createMemoryStorage();
  globalThis.localStorage = storage;
});

// --- D-01: the read path must never replace the user's deck -------------------

test('reading the vocabulary never replaces a small deck that contains a sample word', () => {
  const mine = { id: 'mine_1', word: 'myownword', translation: '我自己的词' };
  StorageService.saveVocabulary([{ id: 'sample_1', word: 'ubiquitous', translation: '无处不在的' }, mine]);
  const rawBefore = storage.getItem('lingoflow_vocabulary');

  const words = StorageService.getVocabulary();

  assert.equal(words.length, 2, 'deck must not be inflated to the 30 demo words');
  assert.ok(words.some((word) => word.word === 'myownword'), 'user word must survive');
  assert.equal(storage.getItem('lingoflow_vocabulary'), rawBefore, 'a getter must not write');
});

test('reading the vocabulary returns a copy so callers cannot corrupt the sample deck', () => {
  const lengthBefore = DEFAULT_SAMPLE_WORDS.length;
  const firstWordBefore = DEFAULT_SAMPLE_WORDS[0].word;

  const words = StorageService.getVocabulary(); // key absent → demo deck
  words.unshift({ id: 'injected', word: 'brandnewword' });

  assert.equal(DEFAULT_SAMPLE_WORDS.length, lengthBefore, 'the exported constant must not grow');
  assert.equal(DEFAULT_SAMPLE_WORDS[0].word, firstWordBefore, 'the constant must not be mutated');
  assert.ok(!StorageService.getVocabulary().some((word) => word.id === 'injected'));
});

// --- D-06: corrupted values must degrade, never crash the render ---------------

test('corrupted stored values degrade to safe shapes instead of throwing', () => {
  storage.setItem('lingoflow_vocabulary', 'null');
  storage.setItem('lingoflow_app_state', 'null');
  storage.setItem('lingoflow_articles', 'null');
  storage.setItem('lingoflow_nce1_cache_v1', 'null');
  storage.setItem('lingoflow_nce1_progress', 'null');
  storage.setItem('lingoflow_study_plan', 'null');
  storage.setItem('lingoflow_study_stats', '"not-an-object"');
  storage.setItem('lingoflow_chat_messages_daily_chat', 'null');

  assert.deepEqual(StorageService.getVocabulary(), []);
  assert.deepEqual(StorageService.getAppState(), {});
  assert.deepEqual(StorageService.getArticles(), []);
  assert.deepEqual(StorageService.getNceCache(), {});
  assert.deepEqual(StorageService.getNceProgress(), {});
  assert.deepEqual(StorageService.getStudyPlan(), {});
  assert.deepEqual(StorageService.getChatMessages('daily_chat'), []);
  assert.equal(StorageService.getStudyStats().streakDays, 0);

  // The call sites that run inside App's useState initializers must be total.
  assert.doesNotThrow(() => StorageService.getVocabulary().filter(Boolean));
  assert.doesNotThrow(() => StorageService.getAppState().activeTab);
  assert.doesNotThrow(() => StorageService.getLocalDataSummary());
  assert.doesNotThrow(() => StorageService.getStorageDiagnostics());
});

// --- D-05: a failed write must not be reported as success ---------------------

test('a failed write is reported instead of returning an advanced SRS card', () => {
  StorageService.saveVocabulary([{ id: 'w1', word: 'alpha', step: 0, intervalDays: 1, easeFactor: 2.5, tags: [] }]);
  const rawBefore = storage.getItem('lingoflow_vocabulary');

  storage.failKeys.add('lingoflow_vocabulary');
  const result = StorageService.updateWordSRS('w1', 'good');

  assert.equal(result, null, 'a scheduling advance that never reached disk must not be reported');
  assert.equal(storage.getItem('lingoflow_vocabulary'), rawBefore, 'stored card must be untouched');
  assert.equal(StorageService.getLastWriteError()?.quotaExceeded, true);
  assert.equal(StorageService.getStorageDiagnostics().lastWriteError?.quotaExceeded, true);
});

// --- D-03 / D-08: import validation, key protection and atomicity -------------

test('import keeps the local speech key when the backup carries none', () => {
  StorageService.saveSettings({ apiKey: 'LOCAL_KEY', speechApiKey: 'LOCAL_SPEECH_KEY', speechModel: 'gpt-4o-mini-tts' });

  const result = StorageService.importAllData(JSON.stringify({
    app: 'LingoFlow',
    version: 3,
    settings: { provider: 'openai', speechApiKey: '' },
  }));

  assert.equal(result.success, true);
  const settings = StorageService.getSettings();
  assert.equal(settings.speechApiKey, 'LOCAL_SPEECH_KEY', 'speech key must survive a safe export');
  assert.equal(settings.apiKey, 'LOCAL_KEY');
  assert.equal(settings.provider, 'openai', 'non-secret settings still merge');
});

test('import rejects another app backup without touching local data', () => {
  StorageService.saveVocabulary([{ id: 'keep', word: 'keepme', translation: '保留' }]);
  const foreign = JSON.stringify({ app: 'SomeOtherApp', version: 9, vocabulary: [{ word: 'intruder' }] });

  const preview = StorageService.parseBackupPreview(foreign);
  assert.equal(preview.valid, false);

  const result = StorageService.importAllData(foreign);
  assert.equal(result.success, false);
  assert.match(result.error, /LingoFlow/);
  assert.deepEqual(StorageService.getVocabulary().map((word) => word.word), ['keepme']);
});

test('import does not regress SRS scheduling of an already mastered word', () => {
  StorageService.saveVocabulary([{
    id: 'w1',
    word: 'handbag',
    translation: '手提包',
    step: 6,
    intervalDays: 30,
    easeFactor: 2.8,
    status: 'mastered',
    nextReviewDate: 999999999999,
    createdAt: 100,
    reviewCount: 12,
  }]);

  const result = StorageService.importAllData(JSON.stringify({
    app: 'LingoFlow',
    version: 3,
    vocabulary: [{
      id: 'imp1',
      word: 'handbag',
      step: 2,
      intervalDays: 1,
      easeFactor: 2.5,
      nextReviewDate: 111,
      createdAt: 999,
      tags: ['旧备份'],
    }],
  }));

  assert.equal(result.success, true);
  const [word] = StorageService.getVocabulary();
  assert.equal(word.id, 'w1', 'identity stays local');
  assert.equal(word.createdAt, 100, 'creation time stays local');
  assert.equal(word.intervalDays, 30, 'interval must not shrink back to 1 day');
  assert.equal(word.easeFactor, 2.8);
  assert.equal(word.nextReviewDate, 999999999999, 'a mastered word must not become due today');
  assert.equal(word.status, 'mastered');
});

test('a failed import rolls back partial writes', () => {
  // Quota is exceeded only by the oversized merged vocabulary, so the earlier settings
  // write succeeds and the rollback must undo it.
  globalThis.localStorage = createMemoryStorage({ maxValueLength: 400 });
  StorageService.saveSettings({ provider: 'deepseek', apiKey: 'LOCAL_KEY' });
  StorageService.saveVocabulary([{ id: 'keep', word: 'keepme' }]);

  const result = StorageService.importAllData(JSON.stringify({
    app: 'LingoFlow',
    version: 3,
    settings: { provider: 'openai' },
    vocabulary: [{ word: 'x'.repeat(600) }],
  }));

  assert.equal(result.success, false);
  assert.equal(result.rolledBack, true);
  assert.equal(StorageService.getSettings().provider, 'deepseek', 'settings must be rolled back');
  assert.deepEqual(StorageService.getVocabulary().map((word) => word.word), ['keepme']);
});

// --- migration + schema marker ------------------------------------------------

test('legacy sample decks are upgraded once and user words are never replaced', () => {
  StorageService.saveVocabulary([
    { id: 'sample_1', word: 'legacy-one' },
    { id: 'sample_2', word: 'legacy-two' },
  ]);

  StorageService.ensureSchema();

  assert.equal(StorageService.getVocabulary().length, DEFAULT_SAMPLE_WORDS.length);
  assert.ok(storage.getItem('lingoflow_vocabulary_legacy_backup'), 'replaced value is backed up');
  assert.equal(storage.getItem('lingoflow_sample_migration_v2'), 'done');

  // A deck that contains any user-created word must be left completely alone.
  const freshStorage = createMemoryStorage();
  globalThis.localStorage = freshStorage;
  StorageService.saveVocabulary([{ id: 'sample_1', word: 'legacy-one' }, { id: 'mine', word: 'myownword' }]);

  StorageService.ensureSchema();

  assert.deepEqual(
    StorageService.getVocabulary().map((word) => word.word).sort(),
    ['legacy-one', 'myownword'],
    'a deck with a user word must never be replaced',
  );
});

test('a non numeric schema marker is repaired', () => {
  storage.setItem('lingoflow_schema_version', 'abc');

  assert.equal(StorageService.ensureSchema(), 3);
  assert.equal(storage.getItem('lingoflow_schema_version'), '3', 'garbage marker must be rewritten');
  assert.equal(StorageService.getSchemaVersion(), 3);
});

// --- D-31: SRS scheduling guard rails -----------------------------------------

test('review intervals never grow past the cap', () => {
  StorageService.saveVocabulary([{ id: 'w1', word: 'alpha', step: 0, intervalDays: 1, easeFactor: 2.5, tags: [] }]);

  const intervals = [];
  for (let i = 0; i < 12; i += 1) {
    intervals.push(StorageService.updateWordSRS('w1', 'good').intervalDays);
  }

  // Previously this sequence reached 3819 days (about 10.4 years).
  assert.ok(
    intervals.every((days) => days <= MAX_INTERVAL_DAYS),
    `every interval must stay <= ${MAX_INTERVAL_DAYS}, got ${intervals.join(', ')}`,
  );
  assert.equal(intervals.at(-1), MAX_INTERVAL_DAYS, 'growth saturates at the cap');
});

test('a difficult one-day card is no longer stuck due every day', () => {
  StorageService.saveVocabulary([{ id: 'w1', word: 'alpha', step: 0, intervalDays: 1, easeFactor: 2.5, tags: [] }]);

  const first = StorageService.updateWordSRS('w1', 'hard');
  assert.ok(first.intervalDays > 1, `hard on a 1-day card must advance, got ${first.intervalDays}`);

  // And it keeps advancing rather than oscillating at a single day.
  storage.failKeys.clear();
  StorageService.saveVocabulary([{ id: 'w2', word: 'beta', step: 1, intervalDays: first.intervalDays, easeFactor: first.easeFactor, tags: [] }]);
  const second = StorageService.updateWordSRS('w2', 'hard');
  assert.ok(second.intervalDays > first.intervalDays, `${second.intervalDays} should exceed ${first.intervalDays}`);
});

test('"again" resets step and interval and penalises ease', () => {
  StorageService.saveVocabulary([{
    id: 'w1', word: 'alpha', step: 6, intervalDays: 120, easeFactor: 2.8, status: 'mastered', tags: [],
  }]);

  const reset = StorageService.updateWordSRS('w1', 'again');

  assert.equal(reset.step, 0);
  assert.equal(reset.intervalDays, 1, 'intervalDays carries the next interval to apply');
  assert.equal(reset.status, 'learning');
  assert.equal(reset.easeFactor, 2.6, 'ease is penalised but stays above the 1.3 floor');
});

// --- V-02: "again" must relearn TODAY, as the UI and the product plan promise ---

test('"again" makes the card due immediately so it re-enters today\'s queue', () => {
  StorageService.saveVocabulary([{
    id: 'w1', word: 'alpha', step: 4, intervalDays: 22, easeFactor: 2.7, status: 'review', tags: [],
  }]);

  const before = Date.now();
  const reset = StorageService.updateWordSRS('w1', 'again');

  // Previously this was `now + 1 day`, so the card silently skipped the current session
  // while the UI said "已自动重置加入今日待复习闪卡队伍".
  assert.ok(reset.nextReviewDate <= before + 1000, 'forgotten card is due now');
  assert.equal(reset.intervalDays, 1, 'intervalDays stays as the next interval to apply');
  assert.equal(StorageService.getVocabulary().find((w) => w.id === 'w1').nextReviewDate <= Date.now(), true);
});

test('"good" and "hard" still schedule into the future', () => {
  StorageService.saveVocabulary([{ id: 'w1', word: 'alpha', step: 1, intervalDays: 1, easeFactor: 2.5, tags: [] }]);
  const good = StorageService.updateWordSRS('w1', 'good');
  assert.ok(good.nextReviewDate > Date.now() + 60 * 1000, 'a success is not due again immediately');

  StorageService.saveVocabulary([{ id: 'w2', word: 'beta', step: 1, intervalDays: 2, easeFactor: 2.5, tags: [] }]);
  const hard = StorageService.updateWordSRS('w2', 'hard');
  assert.ok(hard.nextReviewDate > Date.now() + 60 * 1000);
});

// --- V-03: undoing a rating must restore the word AND the recorded activity ---

test('revertReview restores the word, the stats and the recorded event', () => {
  StorageService.saveVocabulary([{
    id: 'w1', word: 'alpha', step: 3, intervalDays: 8, easeFactor: 2.6, status: 'review', reviewCount: 5, tags: [],
  }]);
  const snapshot = StorageService.getVocabulary().find((w) => w.id === 'w1');
  const statsBefore = StorageService.getStudyStats();

  const rated = StorageService.updateWordSRS('w1', 'again');
  StorageService.recordReviewActivity(1, { entityId: 'w1', durationMinutes: 1 });
  assert.equal(StorageService.getStudyEvents().length, 1, 'the rating recorded an event');

  const restored = StorageService.revertReview({ snapshot, previousStats: statsBefore, entityId: 'w1' });

  assert.equal(restored, true);
  const word = StorageService.getVocabulary().find((w) => w.id === 'w1');
  assert.equal(word.step, 3, 'step is back');
  assert.equal(word.intervalDays, 8, 'interval is back');
  assert.equal(word.easeFactor, 2.6, 'ease is back');
  assert.equal(word.reviewCount, 5, 'review count is back');
  assert.notEqual(word.nextReviewDate, rated.nextReviewDate, 'the rating is gone');
  assert.equal(StorageService.getStudyEvents().length, 0, 'the review event is removed');
  assert.equal(StorageService.getStudyStats().todayReviewedCount, statsBefore.todayReviewedCount);
});

test('revertReview reports failure when the word no longer exists', () => {
  StorageService.saveVocabulary([{ id: 'other', word: 'kept' }]);
  const restored = StorageService.revertReview({ snapshot: { id: 'gone', word: 'ghost' } });
  assert.equal(restored, false);
  assert.deepEqual(StorageService.getVocabulary().map((w) => w.word), ['kept']);
});

test('revertReview only drops the event belonging to that word', () => {
  StorageService.saveVocabulary([{ id: 'w1', word: 'alpha' }, { id: 'w2', word: 'beta' }]);
  const snapshot = StorageService.getVocabulary().find((w) => w.id === 'w1');
  StorageService.recordReviewActivity(1, { entityId: 'w1' });
  StorageService.recordReviewActivity(1, { entityId: 'w2' });

  StorageService.revertReview({ snapshot, entityId: 'w1' });

  const remaining = StorageService.getStudyEvents();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].entityId, 'w2', 'the other word\'s event is untouched');
});

// --- V-04: every vocab mutation must report a dropped write -------------------

test('updateWord and deleteWord report a failed write instead of pretending success', () => {
  const failing = createMemoryStorage();
  globalThis.localStorage = failing;
  StorageService.saveVocabulary([{ id: 'w1', word: 'alpha', translation: 'a' }]);

  failing.failKeys.add('lingoflow_vocabulary');
  assert.equal(StorageService.updateWord('w1', { translation: 'changed' }), null, 'edit must report failure');
  assert.equal(StorageService.deleteWord('w1'), null, 'delete must report failure');

  // Nothing was persisted, so the word is still on disk with its original translation.
  const words = StorageService.getVocabulary();
  assert.equal(words.length, 1);
  assert.equal(words[0].translation, 'a');
});

test('updateWord and deleteWord still succeed on a healthy store', () => {
  StorageService.saveVocabulary([{ id: 'w1', word: 'alpha', translation: 'a' }, { id: 'w2', word: 'beta' }]);
  assert.equal(StorageService.updateWord('w1', { translation: 'changed' }).translation, 'changed');
  assert.deepEqual(StorageService.deleteWord('w2').map((w) => w.id), ['w1']);
});

// --- R-03: reading quietly must be recorded, and read state must survive reloads --------

test('markArticleRead records a finished article and clamps progress to 100', () => {
  StorageService.saveArticle({ id: 'art-1', title: 'One', content: 'Body one' });

  assert.deepEqual(StorageService.getArticleProgress('art-1'), { readAt: 0, percent: 0 });
  assert.equal(StorageService.markArticleRead('art-1'), true);

  const state = StorageService.getArticleProgress('art-1');
  assert.ok(state.readAt > 0, 'a read timestamp is stored');
  assert.equal(state.percent, 100);
  assert.deepEqual(StorageService.getArticleProgress('nope'), { readAt: 0, percent: 0 });
});

test('saveArticleProgress keeps the furthest position and ignores non-progress', () => {
  StorageService.saveArticle({ id: 'art-1', title: 'One', content: 'Body one' });

  assert.equal(StorageService.saveArticleProgress('art-1', 0), false, 'opening an article is not progress');
  assert.equal(StorageService.saveArticleProgress('art-1', 30), true);
  assert.equal(StorageService.getArticleProgress('art-1').percent, 30);

  // Scrolling back up must not lose the furthest point reached.
  StorageService.saveArticleProgress('art-1', 12);
  assert.equal(StorageService.getArticleProgress('art-1').percent, 30);
  assert.equal(StorageService.getArticleProgress('art-1').readAt, 0, 'progress alone is not "finished"');

  StorageService.saveArticleProgress('art-1', 250);
  assert.equal(StorageService.getArticleProgress('art-1').percent, 100, 'percent is clamped');
});

test('markArticleRead keeps existing progress and tolerates legacy numeric records', () => {
  StorageService.saveArticle({ id: 'art-1', title: 'One', content: 'Body one' });
  StorageService.saveArticleProgress('art-1', 40);
  StorageService.markArticleRead('art-1');
  assert.equal(StorageService.getArticleProgress('art-1').percent, 100);

  // Legacy shape: a bare timestamp instead of { readAt, percent }.
  StorageService.saveArticleReadState({ 'art-9': 1700000000000 });
  assert.deepEqual(StorageService.getArticleProgress('art-9'), { readAt: 1700000000000, percent: 0 });
});

test('hasStudyEventToday distinguishes today, other days and other entities', () => {
  StorageService.recordStudyActivity({ type: 'reader', count: 1, entityId: 'art-1', source: 'reader-session' });
  assert.equal(StorageService.hasStudyEventToday({ type: 'reader', entityId: 'art-1' }), true);
  assert.equal(StorageService.hasStudyEventToday({ type: 'reader', entityId: 'art-2' }), false);
  assert.equal(StorageService.hasStudyEventToday({ type: 'review', entityId: 'art-1' }), false);
  assert.equal(StorageService.hasStudyEventToday({}), false);

  // The same event dated two days ago must not count as today.
  const stale = StorageService.getStudyEvents({ limit: 10 })
    .map((event) => ({ ...event, at: Date.now() - 48 * 60 * 60 * 1000 }));
  storage.setItem('lingoflow_study_events_v1', JSON.stringify(stale));
  assert.equal(StorageService.hasStudyEventToday({ type: 'reader', entityId: 'art-1' }), false);
});

// --- Q-01: demo data must be recognisable and clearable -------------------------------

test('sample data is detected on a fresh install and can be cleared for good', () => {
  // A fresh store serves the demo decks from memory without writing them.
  assert.equal(StorageService.isUsingSampleVocabulary(), true);
  assert.ok(StorageService.getVocabulary().length > 0, 'demo words are served');

  assert.equal(StorageService.clearSampleData(), true);

  // The decks are now real (empty) — crucially, reading them must NOT fall back to the demo
  // deck again, which is why clearing writes an explicit [].
  assert.equal(StorageService.isUsingSampleVocabulary(), false);
  assert.deepEqual(StorageService.getVocabulary(), []);
  assert.deepEqual(StorageService.getArticles(), []);
  assert.equal(StorageService.isUsingSampleData(), false);
});

test('clearSampleData can keep the articles when asked', () => {
  assert.equal(StorageService.getArticles().length > 0, true, 'demo articles start out');
  StorageService.clearSampleData({ keepArticles: true });
  assert.deepEqual(StorageService.getVocabulary(), []);
  assert.equal(StorageService.getArticles().length > 0, true, 'articles were kept');
  assert.equal(StorageService.isUsingSampleData(), true, 'articles are still demo content');
});

test('onboarding flags survive and default to unseen', () => {
  assert.equal(StorageService.hasSeenOnboarding('demoNoticeSeen'), false);
  assert.equal(StorageService.markOnboardingSeen('demoNoticeSeen'), true);
  assert.equal(StorageService.hasSeenOnboarding('demoNoticeSeen'), true);
  assert.equal(StorageService.hasSeenOnboarding('neverSet'), false);
  assert.equal(StorageService.markOnboardingSeen(''), false, 'a missing key is rejected');
});

// --- V-24: a word saved without a meaning must stay discoverable ---------------

test('a word added without an AI meaning is findable by the needs-meaning filter', () => {
  // The component used to write the placeholder "自主添加生词" on AI failure, which looked
  // like a real translation and hid the word from the app's own "需要释义" bucket.
  StorageService.addWord({ word: 'handbag', translation: '', tags: ['手动输入'] });

  const all = StorageService.getVocabulary();
  assert.deepEqual(filterVocabulary(all, '', 'needsMeaning').map((w) => w.word), ['handbag']);

  StorageService.addWord({ word: 'umbrella', translation: '雨伞' });
  const afterSecond = StorageService.getVocabulary();
  assert.deepEqual(filterVocabulary(afterSecond, '', 'needsMeaning').map((w) => w.word), ['handbag']);
});
