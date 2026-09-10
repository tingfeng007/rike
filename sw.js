/*!
 * 日课 · Service Worker
 * 目标：装到主屏幕后断网也能完整走一遍复习。
 *
 * 策略
 *   HTML 导航    → 网络优先（在线时总能拿到新版），断网回退缓存
 *   静态资源     → 缓存优先（字体/JS/CSS 基本不变）
 *   words.json   → 先给缓存，同时后台更新（stale-while-revalidate）
 *   跨域请求     → 不拦截（有道发音音频走网络，不缓存）
 *
 * 改完代码记得把 VERSION 加一，否则旧缓存不会换。
 */
var VERSION = 'v1';
var CACHE = 'rike-' + VERSION;

var ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './srs.js',
  './words.json',
  './manifest.json',
  './fonts/fraunces-normal.woff2',
  './fonts/newsreader-normal.woff2',
  './fonts/newsreader-italic.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // 发音音频等外部资源不碰

  // 页面导航：网络优先
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
          return res;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (r) {
            return r || caches.match('./');
          });
        })
    );
    return;
  }

  // 词库：先给缓存，后台悄悄更新
  if (url.pathname.endsWith('words.json')) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (cached) {
          var network = fetch(req).then(function (res) {
            if (res && res.ok) c.put(req, res.clone());
            return res;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
    return;
  }

  // 其余同源静态资源：缓存优先
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
