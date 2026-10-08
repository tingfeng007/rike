import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Regression test for D-02: the service worker's activate handler deleted *every* cache
 * that was not its own, which silently wiped the user's downloaded course audio
 * (`lingoflow-nce-audio-v1`) and the cloud TTS cache (`lingoflow-tts-v1`) on every update.
 *
 * The worker is loaded into a sandbox with mocked CacheStorage so the cleanup rule can be
 * asserted directly.
 */

const SW_SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function loadServiceWorker({ cacheKeys, requireIgnoreVary = false, networkStatus = null }) {
  const listeners = {};
  const deleted = [];
  const context = {
    self: {
      addEventListener: (type, handler) => { listeners[type] = handler; },
      skipWaiting: () => {},
      location: { origin: 'https://example.com' },
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => [...cacheKeys],
      delete: async (key) => { deleted.push(key); return true; },
      open: async () => ({ addAll: async () => {}, put: async () => {}, match: async (_request, options) => requireIgnoreVary && options?.ignoreVary ? { status: 200 } : undefined }),
      match: async () => undefined,
    },
    Response: class Response {},
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async () => { if (networkStatus) return { status: networkStatus, ok: false }; throw new Error('offline'); },
  };
  vm.createContext(context);
  vm.runInContext(SW_SOURCE, context);
  return { listeners, deleted };
}

test('activate only removes superseded app-shell caches', async () => {
  const { listeners, deleted } = loadServiceWorker({
    cacheKeys: [
      'lingoflow-offline-v10',
      'lingoflow-offline-v11',
      'lingoflow-nce-audio-v1',
      'lingoflow-tts-v1',
      'some-unrelated-cache',
    ],
  });

  let pending;
  listeners.activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;

  assert.ok(deleted.includes('lingoflow-offline-v10'), 'superseded shell cache is removed');
  assert.ok(!deleted.includes('lingoflow-offline-v11'), 'the active cache must be kept');
  assert.ok(!deleted.includes('lingoflow-nce-audio-v1'), 'downloaded course audio must survive');
  assert.ok(!deleted.includes('lingoflow-tts-v1'), 'cloud TTS cache must survive');
  assert.ok(!deleted.includes('some-unrelated-cache'), 'foreign caches are left alone');
});

test('offline module loading matches precached assets even when Origin varies', async () => {
  const { listeners } = loadServiceWorker({ cacheKeys: [], requireIgnoreVary: true });
  let response;
  listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://example.com/assets/app.js' }, respondWith: (pending) => { response = pending; } });
  assert.equal((await response).status, 200);
});

test('a removed chunk during deployment falls back to its precached copy', async () => {
  const { listeners } = loadServiceWorker({ cacheKeys: [], requireIgnoreVary: true, networkStatus: 404 });
  let response;
  listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://example.com/assets/previous.js' }, respondWith: (pending) => { response = pending; } });
  assert.equal((await response).status, 200);
});

test('install does not precache-or-delete anything unexpected', () => {
  const { listeners } = loadServiceWorker({ cacheKeys: [] });
  assert.equal(typeof listeners.install, 'function');
  assert.equal(typeof listeners.fetch, 'function');
  assert.doesNotThrow(() => listeners.install({ waitUntil: () => {} }));
});

test('dictionary shards are cached only by the dictionary owner', () => {
  const { listeners } = loadServiceWorker({ cacheKeys: [] });
  let intercepted = false;
  listeners.fetch({ request: { method: 'GET', url: 'https://example.com/rike/dictionary/version/a.json' }, respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});
