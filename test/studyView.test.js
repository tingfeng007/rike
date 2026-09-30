import test from 'node:test';
import assert from 'node:assert/strict';
import { filterVocabulary, getReadingMetrics, filterArticles } from '../src/services/studyView.js';

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

// --- R-02: the精读 library needs search / difficulty / read status / sort ---------------

const ARTICLES = [
  { id: 'a1', title: 'Morning Habits', level: '初级', tags: ['生活方式'], createdAt: 300 },
  { id: 'a2', title: 'Deep Work', level: '中级', tags: ['职场'], createdAt: 200 },
  { id: 'a3', title: 'City Walk', level: '中级', tags: ['旅行'], createdAt: 100 },
];

const PROGRESS = {
  a1: { readAt: 111, percent: 100 }, // finished
  a2: { readAt: 0, percent: 40 },    // half read
  a3: { readAt: 0, percent: 0 },     // untouched
};

const withProgress = () => (id) => PROGRESS[String(id)] || { readAt: 0, percent: 0 };
const ids = (list) => list.map((article) => article.id);

test('filterArticles searches title, level and tags', () => {
  assert.deepEqual(ids(filterArticles(ARTICLES, { query: 'deep' }, withProgress())), ['a2']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { query: '中级' }, withProgress())), ['a2', 'a3']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { query: '旅行' }, withProgress())), ['a3']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { query: '  ' }, withProgress())), ['a1', 'a2', 'a3']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { query: 'nope' }, withProgress())), []);
});

test('filterArticles separates finished, in-progress and unread articles', () => {
  assert.deepEqual(ids(filterArticles(ARTICLES, { status: 'read' }, withProgress())), ['a1']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { status: 'reading' }, withProgress())), ['a2']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { status: 'unread' }, withProgress())), ['a3']);
  assert.equal(filterArticles(ARTICLES, { status: 'all' }, withProgress()).length, 3);
});

test('an article opened but never scrolled still counts as unread', () => {
  // Progress below 1% is deliberately not persisted, so 0 must mean "not started".
  const untouched = () => () => ({ readAt: 0, percent: 0 });
  assert.deepEqual(ids(filterArticles(ARTICLES, { status: 'unread' }, untouched())), ['a1', 'a2', 'a3']);
});

test('filterArticles filters by difficulty level', () => {
  assert.deepEqual(ids(filterArticles(ARTICLES, { level: '中级' }, withProgress())), ['a2', 'a3']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { level: '不存在' }, withProgress())), []);
});

test('filterArticles sorts by recency, title, progress and unfinished-first', () => {
  assert.deepEqual(ids(filterArticles(ARTICLES, { sort: 'recent' }, withProgress())), ['a1', 'a2', 'a3']);
  assert.deepEqual(ids(filterArticles(ARTICLES, { sort: 'progress' }, withProgress())), ['a1', 'a2', 'a3']);
  // "unfinished first" must surface the half-read article, then the rest by recency.
  assert.deepEqual(ids(filterArticles(ARTICLES, { sort: 'unfinished' }, withProgress())), ['a2', 'a1', 'a3']);
  const byTitle = ids(filterArticles(ARTICLES, { sort: 'title' }, withProgress()));
  assert.equal(byTitle.length, 3, 'title sort keeps every article');
  assert.notDeepEqual(byTitle, ids(ARTICLES), 'title sort actually reorders');
});

test('filterArticles combines filters, and tolerates junk input', () => {
  const combined = filterArticles(ARTICLES, { query: '中级', status: 'reading', sort: 'progress' }, withProgress());
  assert.deepEqual(ids(combined), ['a2']);

  assert.deepEqual(filterArticles(null), []);
  assert.deepEqual(ids(filterArticles([null, ARTICLES[0]], {}, withProgress())), ['a1'], 'null rows are skipped');
  // A missing progress accessor must not throw.
  assert.deepEqual(ids(filterArticles(ARTICLES, { status: 'unread' })), ['a1', 'a2', 'a3']);
});
