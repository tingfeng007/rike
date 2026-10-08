import test from 'node:test';
import assert from 'node:assert/strict';

function transactionalDatabase() {
  const records = new Map();
  const state = { rejectWrites: false, commits: 0 };
  const database = {
    createObjectStore() {}, close() {},
    transaction(_store, mode) {
      const staged = new Map(records);
      const transaction = {
        objectStore() {
          return {
            get(key) { const request = {}; queueMicrotask(() => { request.result = staged.get(key); request.onsuccess?.(); }); return request; },
            put(value, key) { staged.set(key, structuredClone(value)); },
          };
        },
      };
      setTimeout(() => {
        if (mode === 'readwrite' && state.rejectWrites) {
          transaction.error = new DOMException('blocked quota', 'QuotaExceededError'); transaction.onabort?.();
        } else {
          if (mode === 'readwrite') { records.clear(); staged.forEach((value, key) => records.set(key, value)); state.commits += 1; }
          transaction.oncomplete?.();
        }
      }, 12);
      return transaction;
    },
  };
  return { state, records, indexedDB: { open() { const request = { result: database }; queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } } };
}

test('actual IndexedDB adapter hydrates and only reports success after commit; abort preserves snapshot', async () => {
  const fake = transactionalDatabase(); globalThis.indexedDB = fake.indexedDB;
  globalThis.localStorage = { getItem: () => null };
  const repository = await import('../src/services/learningStorage.js?transaction-test');
  assert.equal((await repository.initializeLearningStorage()).backend, 'indexedDB');
  const failures = [];
  let settled = false;
  const save = repository.saveLearningDomain('sessions', { oral: { draft: 'persist me' } }, { writeFallback: () => { throw new Error('IDB path must not fake a fallback write'); }, onError: (key, error) => failures.push({ key, name: error.name }) }).then((result) => { settled = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(settled, false);
  assert.equal(repository.getLearningStorageSnapshot().sessions.oral, undefined);
  assert.equal(await save, true);
  assert.equal(fake.records.get('sessions').oral.draft, 'persist me');
  assert.equal(repository.getLearningStorageSnapshot().sessions.oral.draft, 'persist me');
  fake.state.rejectWrites = true;
  assert.equal(await repository.saveLearningDomain('sessions', { oral: { draft: 'must not claim saved' } }, { onError: (key, error) => failures.push({ key, name: error.name }) }), false);
  assert.equal(repository.getLearningStorageSnapshot().sessions.oral.draft, 'persist me');
  assert.equal(fake.records.get('sessions').oral.draft, 'persist me');
  assert.equal(failures[0].name, 'QuotaExceededError');
  delete globalThis.indexedDB;
});
