import { mergeStorageSnapshots } from './storageMerge.js';

export const LEARNING_KEYS = {
  sessions: 'lingoflow_sessions_v1',
  readingEvidence: 'lingoflow_reading_evidence_v1',
  oralCorrections: 'lingoflow_oral_corrections_v1',
};
const empty = () => ({ sessions: {}, readingEvidence: {}, oralCorrections: [] });
let snapshot = empty();
let database = null;
let initializing;
let fallbackStorage;
let channel;
let fallbackReason = '';
const copy = (value) => JSON.parse(JSON.stringify(value));
const valid = (field, value) => field === 'oralCorrections'
  ? Array.isArray(value) ? value.filter((item) => item?.id) : []
  : value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function mergeLearningDomainRecords(field, incoming, current) {
  const stamp = (record) => Number(record?.updatedAt || record?.createdAt || record?.completedAt) || 0;
  if (field === 'oralCorrections') {
    const records = new Map(valid(field, current).map((item) => [item.id, item]));
    for (const item of valid(field, incoming)) if (!records.has(item.id) || stamp(item) >= stamp(records.get(item.id))) records.set(item.id, item);
    return [...records.values()];
  }
  const records = { ...valid(field, current) };
  for (const [id, item] of Object.entries(valid(field, incoming))) if (!(id in records) || stamp(item) >= stamp(records[id])) records[id] = item;
  return records;
}

function readFallback() {
  const state = empty();
  for (const [field, key] of Object.entries(LEARNING_KEYS)) {
    try { state[field] = valid(field, JSON.parse(globalThis.localStorage?.getItem(key) || 'null')); } catch { /* Corrupt storage remains untouched. */ }
  }
  return state;
}

export function getLearningStorageSnapshot() {
  if (!database) {
    if (fallbackStorage !== globalThis.localStorage) fallbackStorage = globalThis.localStorage;
    snapshot = readFallback();
  }
  return copy(snapshot);
}

export function getLearningStorageStatus() {
  return { backend: database ? 'indexedDB' : 'localStorage', initialized: Boolean(initializing), database: database ? 'lingoflow-learning' : '', fallbackReason };
}

async function readDatabase() {
  return new Promise((resolve, reject) => {
    const next = empty();
    const transaction = database.transaction('learning', 'readonly');
    for (const field of Object.keys(next)) {
      const request = transaction.objectStore('learning').get(field);
      request.onsuccess = () => { next[field] = valid(field, request.result); };
    }
    transaction.oncomplete = () => resolve(next);
    transaction.onabort = () => reject(transaction.error || new Error('学习记录读取失败'));
  });
}

export async function initializeLearningStorage() {
  if (initializing) return initializing;
  initializing = (async () => {
    snapshot = readFallback();
    if (!globalThis.indexedDB) return getLearningStorageStatus();
    try {
      database = await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => { settled = true; reject(new Error('学习数据库打开超时')); }, 5000);
        const request = indexedDB.open('lingoflow-learning', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('learning');
        request.onerror = () => { clearTimeout(timer); settled = true; reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); settled = true; reject(new Error('请关闭旧版本页面后重试')); };
        request.onsuccess = () => {
          clearTimeout(timer);
          if (settled) { request.result.close(); return; }
          settled = true;
          resolve(request.result);
        };
      });
      // Copy legacy/staged data once; existing IDB records always remain authoritative.
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('learning', 'readwrite');
        const store = transaction.objectStore('learning');
        for (const field of Object.keys(snapshot)) {
          const request = store.get(field);
          request.onsuccess = () => { if (request.result === undefined) store.put(snapshot[field], field); };
        }
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error || new Error('学习数据迁移失败'));
      });
      snapshot = await readDatabase();
      database.onversionchange = () => { database?.close(); database = null; initializing = null; };
      if (typeof BroadcastChannel === 'function' && typeof window !== 'undefined') {
        channel = new BroadcastChannel('lingoflow-learning');
        channel.onmessage = async () => {
          try { snapshot = await readDatabase(); window.dispatchEvent(new CustomEvent('lingoflow:storage', { detail: { key: 'learning' } })); } catch { /* Next write still re-reads the authoritative transaction. */ }
        };
      }
    } catch (error) {
      database?.close(); database = null;
      fallbackReason = error?.message || '数据库不可用';
    }
    return getLearningStorageStatus();
  })();
  return initializing;
}

// The Promise resolves only after the transaction commits. No pending write is reported saved.
export async function saveLearningDomain(field, next, { writeFallback, onError = () => {}, onConflict = () => {} } = {}) {
  try {
    if (!(field in LEARNING_KEYS) || JSON.stringify(next).length > 2 * 1024 * 1024 || (field === 'sessions' && Object.keys(next).length > 200) || (field === 'oralCorrections' && next.length > 1000)) throw new Error('学习记录超过保存上限，请先导出备份并清理旧记录');
  } catch (error) { onError(LEARNING_KEYS[field] || 'learning', error); return false; }
  const baseline = getLearningStorageSnapshot()[field];
  await initializeLearningStorage();
  if (!database) {
    const remote = readFallback()[field];
    const merged = mergeStorageSnapshots(baseline, valid(field, next), remote, onConflict);
    return writeFallback(LEARNING_KEYS[field], JSON.stringify(merged));
  }
  try {
    let committed;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('learning', 'readwrite');
      const store = transaction.objectStore('learning');
      const request = store.get(field);
      request.onsuccess = () => {
        committed = mergeStorageSnapshots(baseline, valid(field, next), valid(field, request.result), onConflict);
        store.put(committed, field);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error('学习记录保存失败'));
    });
    snapshot[field] = committed;
    channel?.postMessage({ field });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lingoflow:storage', { detail: { key: LEARNING_KEYS[field] } }));
    return true;
  } catch (error) { onError(LEARNING_KEYS[field], error); return false; }
}

export async function restoreLearningDomains(incoming, { writeFallback, onError = () => {} } = {}) {
  await initializeLearningStorage();
  const fields = Object.keys(LEARNING_KEYS).filter((field) => incoming[field] !== undefined);
  for (const field of fields) {
    if (JSON.stringify(incoming[field]).length > 2 * 1024 * 1024) { onError(LEARNING_KEYS[field], new Error('备份中的练习记录超过保存上限')); return false; }
  }
  if (!database) {
    const before = readFallback();
    const written = [];
    for (const field of fields) {
      const merged = mergeLearningDomainRecords(field, incoming[field], before[field]);
      if (!writeFallback(LEARNING_KEYS[field], JSON.stringify(merged))) {
        for (const previous of written) writeFallback(LEARNING_KEYS[previous], JSON.stringify(before[previous]));
        return false;
      }
      written.push(field);
    }
    return true;
  }
  try {
    const committed = {};
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('learning', 'readwrite');
      const store = transaction.objectStore('learning');
      for (const field of fields) {
        const request = store.get(field);
        request.onsuccess = () => {
          committed[field] = mergeLearningDomainRecords(field, incoming[field], request.result);
          store.put(committed[field], field);
        };
      }
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error('学习记录恢复失败'));
    });
    snapshot = { ...snapshot, ...committed };
    channel?.postMessage({ restored: true });
    return true;
  } catch (error) { onError('learning', error); return false; }
}
