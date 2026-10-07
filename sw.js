/*!
 * LingoFlow Offline Resilience Service Worker (network-first)
 *
 * This is the single registered service worker. It replaced the previous
 * "copy the file and bump the filename" scheme (sw-v5.js … sw-v10.js), where six
 * near-identical files were published and only one was ever registered.
 *
 * Cache version: lingoflow-offline-v11
 */

const CACHE_NAME = "lingoflow-offline-16bad0f310c0";
const SHELL_ASSETS = ["./index.html","./icon.svg","./manifest.json","./assets/index-BpWdsgKj.js","./assets/Dictionary-BXulJ5mP.js","./assets/IconButton-CMBJGaPo.js","./assets/NewConcept-CXNp-UYN.js","./assets/OralCoach-o9-yTS8L.js","./assets/Settings-BmRbymFv.js","./assets/SmartReader-C69o0waA.js","./assets/StudyHeader-Ck_TOsmW.js","./assets/WordGrammarHub-Crk3GlMV.js","./assets/bookmark-plus-Dy63IR0W.js","./assets/categoryVocabulary-BQg9zaSu.js","./assets/chevron-right-Jojtk1Au.js","./assets/confetti.module-Uxh4CK4s.js","./assets/download-D-cddvBf.js","./assets/key-DQ1wxjmJ.js","./assets/languages-kXydMCG7.js","./assets/latestRequest-BXQtO2QU.js","./assets/offline-Cxa-gPB-.js","./assets/play-BYt-mhYb.js","./assets/rotate-ccw-DrHh7Loj.js","./assets/speech-njJ1TPEo.js","./assets/studyView-CZg7wTmr.js","./assets/target-BSkxWAdN.js","./assets/toastContext-D9PpOGxq.js","./assets/trash-Dh4Cv6-q.js","./assets/trophy-ORWAfI2-.js","./assets/useStudyClock-BC93N8Ln.js","./assets/Dictionary-CdJ5rrzW.css","./assets/index-C2dzAesa.css"];

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

  event.respondWith(
    fetch(request)
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
