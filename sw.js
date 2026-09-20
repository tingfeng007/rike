/*!
 * LingoFlow Offline Resilience Service Worker (Network-First Strategy)
 * Cache version: lingoflow-offline-v5
 */

const CACHE_NAME = 'lingoflow-offline-v5';

self.addEventListener('install', (_event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests from the same origin (static assets & navigation)
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Network-first strategy: try network, fallback to cache, and save updated responses
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, resClone);
          });
        }
        return networkRes;
      })
      .catch(async () => {
        // Network failed (offline), look into cache
        const cached = await caches.match(req);
        if (cached) {
          return cached;
        }

        // For navigation requests, fallback to root index.html
        if (req.mode === 'navigate') {
          const fallbackHtml = await caches.match('./index.html') || await caches.match('./');
          if (fallbackHtml) {
            return fallbackHtml;
          }
        }

        return new Response('离线状态：该资源尚未缓存，请联网后访问。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
  );
});
