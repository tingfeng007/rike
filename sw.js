/*!
 * LingoFlow Offline Resilience Service Worker (network-first)
 *
 * This is the single registered service worker. It replaced the previous
 * "copy the file and bump the filename" scheme (sw-v5.js … sw-v10.js), where six
 * near-identical files were published and only one was ever registered.
 *
 * Cache version: lingoflow-offline-v11
 */

const CACHE_NAME = 'lingoflow-offline-v11';

// Caches owned by other parts of the app. The previous activate handler deleted every
// cache that was not its own, which silently destroyed the user's deliberately
// downloaded course audio (lingoflow-nce-audio-v1, see services/offline.js) and the
// cloud TTS cache (lingoflow-tts-v1, see services/speech.js) on every worker update.
const APP_CACHE_NAMES = ['lingoflow-nce-audio-v1', 'lingoflow-tts-v1'];
const MANAGED_PREFIX = 'lingoflow-offline-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => {
          // Only clean up our own, superseded app-shell caches.
          const isOurs = key.startsWith(MANAGED_PREFIX);
          const isProtected = APP_CACHE_NAMES.includes(key);
          if (isOurs && !isProtected && key !== CACHE_NAME) return caches.delete(key);
          return undefined;
        }),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          // Tie the write to the event lifetime: the previous fire-and-forget
          // `caches.open(...).then(put)` could be dropped when the worker was stopped.
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined),
          );
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html') || await caches.match('./');
          if (fallback) return fallback;
        }

        return new Response('离线状态：该资源尚未缓存，请联网后访问。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
