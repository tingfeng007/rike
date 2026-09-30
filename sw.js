/*!
 * LingoFlow Offline Resilience Service Worker (network-first)
 *
 * This is the single registered service worker. It replaced the previous
 * "copy the file and bump the filename" scheme (sw-v5.js … sw-v10.js), where six
 * near-identical files were published and only one was ever registered.
 *
 * Cache version: lingoflow-offline-v11
 */

const CACHE_NAME = "lingoflow-offline-715379f5031b";
const SHELL_ASSETS = ["./index.html","./icon.svg","./manifest.json","./assets/index-D_kDt8JI.js","./assets/IconButton-05CKS2sx.js","./assets/NewConcept-D3kz0mbd.js","./assets/OralCoach-DcwA3VOv.js","./assets/Settings-CzoGmJej.js","./assets/SmartReader-_HXM0Tug.js","./assets/StudyHeader-C90uCJLG.js","./assets/WordGrammarHub-CgR8Yymk.js","./assets/chevron-right-LJZ6UStU.js","./assets/confetti.module-Uxh4CK4s.js","./assets/download-C82dBVWh.js","./assets/jsx-runtime-Bw7O_yca.js","./assets/key-BPsl1zMP.js","./assets/languages-C02sjK_t.js","./assets/offline-Cxa-gPB-.js","./assets/play-BUKOGdcv.js","./assets/speech-CzS2sFZn.js","./assets/studyView-CJbyzk2U.js","./assets/target-DwwNf6vs.js","./assets/trash-BGqVSjM1.js","./assets/trophy-DjwXeJIV.js","./assets/useStudyClock-DJxVRFXX.js","./assets/index-BCyAz5EK.css"];

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
