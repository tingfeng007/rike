import test from 'node:test';
import assert from 'node:assert/strict';
import { clearManagedCaches, getCacheDiagnostics, readCachedSpeech, TTS_CACHE, writeBoundedSpeech } from '../src/services/cacheManagement.js';
import { createTimedRequest } from '../src/services/requestTimeout.js';
import { createDictionaryService } from '../src/services/dictionary.js';

function memoryCaches() {
  const caches = new Map();
  return { caches, keys: async () => [...caches.keys()], delete: async (name) => caches.delete(name), open: async (name) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const entries = caches.get(name);
    return { keys: async () => [...entries.keys()], match: async (key) => entries.get(key)?.clone(), put: async (key, response) => entries.set(key, response.clone()), delete: async (key) => entries.delete(key) };
  } };
}

test('speech LRU has both count and byte bounds and touched entries survive eviction', async () => {
  const storage = memoryCaches();
  const write = (key) => writeBoundedSpeech(storage, key, new Blob(['1234']), { maxEntries: 2, maxBytes: 8 });
  await write('a'); await new Promise((resolve) => setTimeout(resolve, 2));
  await write('b'); await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal((await readCachedSpeech(storage, 'a')).size, 4);
  await new Promise((resolve) => setTimeout(resolve, 2)); await write('c');
  const cache = await storage.open(TTS_CACHE);
  assert.deepEqual(await cache.keys(), ['a', 'c']);
  const diagnostics = await getCacheDiagnostics(storage);
  assert.equal(diagnostics.groups[0].bytes, 8);
  await storage.open('lingoflow-offline-current'); await storage.open('unrelated');
  assert.equal(await clearManagedCaches('speech', storage), true);
  assert.ok((await storage.keys()).includes('lingoflow-offline-current'));
  assert.ok((await storage.keys()).includes('unrelated'));
});

test('dictionary deletes a corrupt cached shard and repairs it from the network', async () => {
  const storage = memoryCaches(); let calls = 0;
  const bad = await storage.open('lingoflow-dictionary-v1');
  const { DICTIONARY_VERSION } = await import('../src/services/dictionary.js');
  await bad.put(`/dictionary/${DICTIONARY_VERSION}/x.json`, new Response('broken JSON'));
  const service = createDictionaryService({ cacheStorage: storage, fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ xyz: ['xyz', 'test', 'meaning'] })); } });
  assert.equal((await service.lookup('xyz', { storage: { getItem: () => null } })).word, 'xyz');
  assert.equal(calls, 1);
  assert.ok((await bad.match(`/dictionary/${DICTIONARY_VERSION}/x.json`)).headers);
});

test('old lookup history receives newly sourced IPA while preserving paid AI examples', async () => {
  const { rememberDictionaryEntry, readDictionaryState } = await import('../src/services/dictionary.js');
  let state;
  const storage = { getItem: () => state || null, setItem: (_key, value) => { state = value; } };
  rememberDictionaryEntry({ word: 'xyz', phonetic: '', translation: 'meaning', meanings: [{ pos: 'n.', text: 'meaning' }], forms: [], source: 'ECDICT', aiEnriched: true, contextSentence: 'My existing example.' }, storage);
  const service = createDictionaryService({ cacheStorage: undefined, fetchImpl: async () => new Response(JSON.stringify({ xyz: ['xyz', 'ɪpə', 'meaning', '', '', '', 'ipa-dict'] })) });
  const refreshed = await service.lookup('xyz', { storage });
  assert.equal(refreshed.phonetic, '/ɪpə/');
  assert.equal(refreshed.phoneticSource, 'ipa-dict');
  assert.equal(refreshed.contextSentence, 'My existing example.');
  rememberDictionaryEntry(refreshed, storage);
  assert.equal(readDictionaryState(storage).entries[0].contextSentence, 'My existing example.');
});

test('request deadlines abort hanging work and cleanup removes caller forwarding', async () => {
  const caller = new AbortController();
  const request = createTimedRequest(caller.signal, 10);
  await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(request.timedOut, true);
  assert.equal(request.signal.reason.name, 'TimeoutError');
  request.cleanup();
  const other = createTimedRequest(caller.signal, 1000); other.cleanup(); caller.abort();
  assert.equal(other.signal.aborted, false);
});

test('cloud speech returns to caller when the provider hangs', async () => {
  globalThis.window = { location: { origin: 'https://example.test' } };
  const { tts } = await import('../src/services/speech.js');
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn; console.warn = () => {};
  globalThis.fetch = async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  try {
    const result = await tts.speakCloud('test', { speechApiKey: 'TEST_ONLY', speechBaseUrl: 'https://example.test/v1' }, tts.playToken, { timeoutMs: 10 });
    assert.equal(result, false);
    assert.equal(tts.activeRequestController, null);
  } finally { globalThis.fetch = originalFetch; console.warn = originalWarn; delete globalThis.window; }
});
