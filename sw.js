/*!
 * LingoFlow Offline Resilience Service Worker (network-first)
 *
 * This is the single registered service worker. It replaced the previous
 * "copy the file and bump the filename" scheme (sw-v5.js … sw-v10.js), where six
 * near-identical files were published and only one was ever registered.
 *
 * Cache version: lingoflow-offline-v11
 */

const CACHE_NAME = "lingoflow-offline-09309f4a8614";
const SHELL_ASSETS = ["./index.html","./icon.svg","./icon-192.png","./icon-512.png","./apple-touch-icon.png","./manifest.json","./assets/index-CvGwKWEP.js","./assets/Dictionary-zEtBsV5r.js","./assets/IconButton-BM4jtLA_.js","./assets/NewConcept-DRgQ_Clc.js","./assets/OralCoach-P-t2O6t9.js","./assets/QuickWordLookup-AnYrUKa8.js","./assets/Settings-BTgIYf5g.js","./assets/SmartReader-DIgBUU4h.js","./assets/StudyHeader-Bs5PRnS3.js","./assets/WordGrammarHub-DRHHqDcA.js","./assets/WordLookupText-BYcenVb4.js","./assets/bookmark-plus-CiUVbVI_.js","./assets/confetti.module-Uxh4CK4s.js","./assets/dictionary-CMNDNYZP.js","./assets/download-CJ2MV5qi.js","./assets/external-link-Dh4MRclI.js","./assets/languages-Bc-0duuD.js","./assets/offline-DL4_bXWJ.js","./assets/play-Cu7l-DCY.js","./assets/rotate-ccw-DUnwkh3L.js","./assets/save-j9Rn236Q.js","./assets/speech-BotB84Xw.js","./assets/studyView-DKdAcfmE.js","./assets/target-DojZ1Ytn.js","./assets/toastContext-BmMQSovJ.js","./assets/trophy-BHYsIALA.js","./assets/useStudyClock-B8pr5nk7.js","./assets/wordTokens-CHC6g_Z-.js","./assets/Dictionary-Cdih9oCE.css","./assets/index-Bl6YtYHv.css"];

// Caches owned by other parts of the app. The previous activate handler deleted every
// cache that was not its own, which silently destroyed the user's deliberately
// downloaded course audio (lingoflow-nce-audio-v1, see services/offline.js) and the
// cloud TTS cache (lingoflow-tts-v1, see services/speech.js) on every worker update.
const APP_CACHE_NAMES = ['lingoflow-nce-audio-v1', 'lingoflow-tts-v1'];
const MANAGED_PREFIX = 'lingoflow-offline-';

self.addEventListener('install', (event) => {
  // Let existing tabs finish with their current worker and chunks. Taking over here
  // and deleting the old shell can break a lazy import in an already-open lesson.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
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
  // The dictionary owns and validates these shards. Keeping a second copy here doubles
  // disk use and prevents its corruption-repair fetch from reaching the network.
  if (new URL(request.url).pathname.includes('/dictionary/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreVary: true });
      // Hashed chunks are immutable; use them immediately rather than waiting on weak Wi-Fi.
      if (cached && /\/assets\/[^/]+-[^/]+\.(js|css)$/.test(new URL(request.url).pathname)) return cached;
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          fetch(request, { signal: controller.signal }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Network timeout')); }, 2500); }),
        ]);
      } finally { clearTimeout(timer); }
    })()
      .then((response) => {
        if (!response || response.status >= 400) throw new Error('Resource unavailable');
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
        const cache = await caches.open(CACHE_NAME);
        // Vite serves static files with Vary: Origin. Precache requests do not carry
        // the module-loader Origin header; these immutable same-origin assets are
        // identical for both requests, so that header must not defeat offline lookup.
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const fallback = await cache.match('./index.html') || await cache.match('./');
          if (fallback) return fallback;
        }

        return new Response('离线状态：该资源尚未缓存，请联网后访问。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
