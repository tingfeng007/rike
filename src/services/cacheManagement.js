export const TTS_CACHE = 'lingoflow-tts-v1';
export const TTS_CACHE_MAX_ENTRIES = 64;
export const TTS_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const kinds = { course: 'lingoflow-nce-audio-v1', dictionary: 'lingoflow-dictionary-', speech: TTS_CACHE };
let audioQueue = Promise.resolve();

export async function getCacheDiagnostics(cacheStorage = globalThis.caches) {
  if (!cacheStorage) return { supported: false, groups: [], usage: 0, quota: 0, persisted: false };
  const groups = [];
  for (const name of await cacheStorage.keys()) {
    const kind = Object.keys(kinds).find((key) => name.startsWith(kinds[key])) || (name.startsWith('lingoflow-offline-') ? 'app' : '');
    if (!kind) continue;
    const cache = await cacheStorage.open(name);
    const requests = await cache.keys();
    let bytes = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) bytes += Number(response.headers.get('Content-Length')) || (await response.blob()).size;
    }
    groups.push({ name, kind, entries: requests.length, bytes });
  }
  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => ({})) || {};
  const persisted = await globalThis.navigator?.storage?.persisted?.().catch(() => false) || false;
  return { supported: true, groups, usage: estimate.usage || 0, quota: estimate.quota || 0, persisted };
}

export async function requestPersistentStorage() {
  return Boolean(await globalThis.navigator?.storage?.persist?.().catch(() => false));
}

export async function clearManagedCaches(kind, cacheStorage = globalThis.caches) {
  if (!cacheStorage || !(kind in kinds)) return false;
  const names = (await cacheStorage.keys()).filter((name) => name.startsWith(kinds[kind]));
  await Promise.all(names.map((name) => cacheStorage.delete(name)));
  return true;
}

export async function readCachedSpeech(cacheStorage, key) {
  const cache = await cacheStorage.open(TTS_CACHE);
  const response = await cache.match(key);
  if (!response) return null;
  const blob = await response.blob();
  // Touch the timestamp for true LRU; failure never prevents playback.
  try { await cache.put(key, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size), 'X-LingoFlow-Used': String(Date.now()) } })); } catch { /* Optional cache. */ }
  return blob;
}

export async function writeBoundedSpeech(cacheStorage, key, blob, { maxEntries = TTS_CACHE_MAX_ENTRIES, maxBytes = TTS_CACHE_MAX_BYTES } = {}) {
  const update = async () => {
    const cache = await cacheStorage.open(TTS_CACHE);
    if (blob.size > maxBytes) return;
    await cache.put(key, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size), 'X-LingoFlow-Used': String(Date.now()) } }));
    const rows = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response) continue;
      rows.push({ request, used: Number(response.headers.get('X-LingoFlow-Used')) || 0, bytes: Number(response.headers.get('Content-Length')) || (await response.blob()).size });
    }
    rows.sort((a, b) => a.used - b.used);
    let bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    while (rows.length > maxEntries || bytes > maxBytes) {
      const row = rows.shift();
      await cache.delete(row.request); bytes -= row.bytes;
    }
  };
  const run = () => globalThis.navigator?.locks ? navigator.locks.request('lingoflow-tts-cache', update) : update();
  const pending = audioQueue.then(run, run);
  audioQueue = pending.catch(() => {});
  return pending;
}
