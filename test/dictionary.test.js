import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildDictionaryWordPayload,
  clearDictionaryHistory,
  createDictionaryService,
  decodeDictionaryRow,
  DICTIONARY_VERSION,
  DICTIONARY_WORD_COUNT,
  isDictionaryQuery,
  lookupOnlineDictionary,
  normalizeDictionaryQuery,
  readDictionaryState,
  rememberDictionaryEntry,
  suggestDictionaryWords,
} from '../src/services/dictionary.js';

const memoryStorage = () => {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
};
const row = [
  'learn',
  'lɜːn',
  'v. 学习\\nn. 学问',
  'To acquire knowledge.',
  'd:learnt,learned/p:learned/i:learning/3:learns',
  'cet4 cet6',
];
const fetchShard = async (url) =>
  new Response(await readFile(new URL(`../public${url}`, import.meta.url)));

test('dictionary flashcards keep meanings, pronunciation and source without repeated POS labels', () => {
  const payload = buildDictionaryWordPayload(decodeDictionaryRow(row));
  assert.equal(payload.translation, '学习；学问');
  assert.equal(payload.pos, 'v. / n.');
  assert.equal(payload.phonetic, '/lɜːn/');
  assert.equal(payload.sources[0].id, 'learn');
  assert.equal(payload.sources[0].type, 'dictionary');
  assert.equal(
    buildDictionaryWordPayload({
      ...decodeDictionaryRow(row),
      englishOnly: true,
    }).translation,
    '',
  );
});

test('dictionary query normalization accepts phrases and rejects unsuitable input', () => {
  assert.equal(
    normalizeDictionaryQuery('  Play   it by ear  '),
    'play it by ear',
  );
  assert.equal(normalizeDictionaryQuery('Don’t'), "don't");
  for (const value of ['word', 'give up', 'fact-check', "don't"])
    assert.ok(isDictionaryQuery(value));
  for (const value of [null, {}, '中文', '<script>', 'a'.repeat(65)])
    assert.equal(isDictionaryQuery(value), false);
});

test('dictionary rows preserve multiple senses, pronunciation and clickable alternate forms', () => {
  const entry = decodeDictionaryRow(row);
  assert.deepEqual(entry.meanings, [
    { pos: 'v.', text: '学习' },
    { pos: 'n.', text: '学问' },
  ]);
  assert.equal(entry.phonetic, '/lɜːn/');
  assert.equal(entry.forms.length, 5);
  assert.deepEqual(entry.forms.slice(0, 2), [
    { label: '过去式', word: 'learnt' },
    { label: '过去式', word: 'learned' },
  ]);
  assert.equal(decodeDictionaryRow(['broken', null, '']), null);
});

test('bundled dictionary counts and common words agree with the published manifest', async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        `../public/dictionary/${DICTIONARY_VERSION}/manifest.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
  let count = 0;
  for (const [letter, part] of Object.entries(manifest.shards)) {
    const text = await readFile(
      new URL(
        `../public/dictionary/${DICTIONARY_VERSION}/${letter}.json`,
        import.meta.url,
      ),
    );
    const shard = JSON.parse(text);
    assert.equal(Object.keys(shard).length, part.count);
    assert.equal(text.length, part.bytes);
    assert.ok(
      Object.entries(shard).every(
        ([key, value]) =>
          key[0] === letter && decodeDictionaryRow(value)?.meanings.length,
      ),
    );
    count += part.count;
  }
  assert.equal(count, DICTIONARY_WORD_COUNT);
  assert.equal(count, manifest.count);
  const service = createDictionaryService({
    fetchImpl: fetchShard,
    cacheStorage: undefined,
  });
  for (const word of [
    'hello',
    'apple',
    'algorithm',
    'computer',
    'deadline',
    'resilience',
  ]) {
    const entry = await service.lookup(word, { storage: memoryStorage() });
    assert.ok(entry?.phonetic, word);
    assert.ok(entry?.translation, word);
  }
});

test('lookups fetch only the relevant letter, reuse it, and preserve curated examples', async () => {
  const calls = [];
  const service = createDictionaryService({
    cacheStorage: undefined,
    fetchImpl: async (url) => {
      calls.push(url);
      return fetchShard(url);
    },
  });
  const budget = await service.lookup('budget', { storage: memoryStorage() });
  assert.ok(budget.contextSentence);
  assert.ok(budget.contextSentenceCn);
  const sustainable = await service.lookup('sustainable', {
    storage: memoryStorage(),
  });
  assert.ok(
    sustainable.meanings.some((meaning) => meaning.text.includes('可持续')),
  );
  assert.ok(sustainable.contextSentence.includes('sustainable transport'));
  await service.lookup('business', { storage: memoryStorage() });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].endsWith('/b.json'));
});

test('offline lookup uses saved results, falls back to learning words, and never invents unknown meanings', async () => {
  const storage = memoryStorage();
  rememberDictionaryEntry(decodeDictionaryRow(row), storage);
  const service = createDictionaryService({
    cacheStorage: undefined,
    fetchImpl: async () => {
      throw new TypeError('offline');
    },
  });
  assert.equal(
    (await service.lookup('learn', { storage })).translation,
    'v. 学习\nn. 学问',
  );
  assert.ok((await service.lookup('agenda', { storage })).contextSentenceCn);
  await assert.rejects(service.lookup('xyzunknown', { storage }), /offline/);
  const onlineService = createDictionaryService({
    cacheStorage: undefined,
    fetchImpl: async () => new Response(JSON.stringify({ word: row })),
  });
  assert.equal(await onlineService.lookup('wordzzzz', { storage }), null);
});

test('history and cache are bounded, deduplicated, and survive malformed storage', () => {
  const storage = memoryStorage();
  for (let i = 0; i < 60; i += 1)
    rememberDictionaryEntry(
      {
        ...decodeDictionaryRow(row),
        word:
          'word' +
          String.fromCharCode(97 + Math.floor(i / 26)) +
          String.fromCharCode(97 + (i % 26)),
      },
      storage,
    );
  assert.equal(readDictionaryState(storage).entries.length, 40);
  assert.equal(readDictionaryState(storage).history.length, 12);
  const entry = decodeDictionaryRow(row);
  rememberDictionaryEntry(entry, storage);
  rememberDictionaryEntry(entry, storage);
  assert.equal(
    readDictionaryState(storage).history.filter((word) => word === 'learn')
      .length,
    1,
  );
  assert.ok(clearDictionaryHistory(storage));
  assert.equal(readDictionaryState(storage).history.length, 0);
  assert.equal(readDictionaryState(storage).entries.length, 40);
  assert.deepEqual(readDictionaryState({ getItem: () => '{oops' }), {
    entries: [],
    history: [],
  });
  assert.deepEqual(
    readDictionaryState({
      getItem: () =>
        JSON.stringify({
          history: {},
          entries: [{ word: 'hello', translation: '你好', meanings: null }],
        }),
    }),
    { entries: [], history: [] },
  );
  assert.equal(
    rememberDictionaryEntry(entry, {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    }),
    false,
  );
});

test('suggestions include prefixes and near spellings without echoing exact matches', () => {
  assert.deepEqual(
    suggestDictionaryWords(['algorithm', 'algorithms', 'algebra'], 'alg'),
    ['algorithm', 'algorithms', 'algebra'],
  );
  assert.ok(
    suggestDictionaryWords(['algorithm', 'algorithms', 'algebra'], 'algoritm', {
      fuzzy: true,
    }).includes('algorithm'),
  );
  assert.ok(
    !suggestDictionaryWords(['learn', 'learning'], 'learn').includes('learn'),
  );
});

test('aborted lookup is stopped and does not commit a shard', async () => {
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  const service = createDictionaryService({
    cacheStorage: undefined,
    fetchImpl: async () => {
      fetched = true;
      return new Response('{}');
    },
  });
  await assert.rejects(
    service.lookup('unknown', {
      signal: controller.signal,
      storage: memoryStorage(),
    }),
    { name: 'AbortError' },
  );
  assert.equal(fetched, false);
});

test('online fallback handles multiple entries, 404 and malformed providers', async () => {
  const entry = await lookupOnlineDictionary('test', {
    fetchImpl: async () =>
      new Response(
        JSON.stringify([
          {
            word: 'test',
            phonetics: [{ text: '/test/' }],
            meanings: [
              {
                partOfSpeech: 'noun',
                definitions: [
                  { definition: 'A trial.', example: 'Take the test.' },
                ],
              },
            ],
          },
          {
            word: 'test',
            meanings: [
              {
                partOfSpeech: 'verb',
                definitions: [{ definition: 'To examine.' }],
              },
            ],
          },
        ]),
      ),
  });
  assert.equal(entry.meanings.length, 2);
  assert.equal(entry.englishOnly, true);
  assert.equal(entry.translation, '');
  assert.equal(entry.phonetic, '/test/');
  assert.equal(entry.contextSentence, 'Take the test.');
  const storage = memoryStorage();
  rememberDictionaryEntry(entry, storage);
  assert.equal(readDictionaryState(storage).entries.length, 1);
  assert.equal(
    await lookupOnlineDictionary('test', {
      fetchImpl: async () => new Response('{}', { status: 404 }),
    }),
    null,
  );
  assert.equal(
    await lookupOnlineDictionary('test', {
      fetchImpl: async () => new Response('{"meanings":{}}'),
    }),
    null,
  );
});

test('downloaded shards work after service restart, and cancellation can be resumed', async () => {
  const stored = new Map();
  const cacheStorage = {
    open: async () => ({
      match: async (url) => stored.get(url)?.clone(),
      put: async (url, response) => stored.set(url, response),
      keys: async () => [...stored.keys()],
      delete: async (url) => stored.delete(url),
    }),
  };
  const controller = new AbortController();
  const service = createDictionaryService({
    cacheStorage,
    fetchImpl: async (url) =>
      new Response(JSON.stringify({ [url.split('/').at(-1)[0]]: row })),
  });
  await assert.rejects(
    service.download({
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress > 10) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(await service.isDownloaded(), false);
  await service.download();
  assert.equal(await service.isDownloaded(), true);
  const offline = createDictionaryService({
    cacheStorage,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.ok(await offline.lookup('l', { storage: memoryStorage() }));
});
