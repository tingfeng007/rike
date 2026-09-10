/*!
 * 日课 · Service Worker
 * 目标：装到主屏幕后断网也能完整走一遍复习，同时保证更新能真的送达。
 *
 * 策略（这里的取舍是有原因的，改之前先读完）
 *   页面导航        → 网络优先，断网回退缓存
 *   .js / .css      → 网络优先，断网回退缓存
 *   词库 words.json → 先给缓存，同时后台更新（stale-while-revalidate）
 *   字体 / 图标     → 缓存优先（文件名基本不变，属于事实上的不可变资源）
 *   跨域请求        → 不拦截（有道发音音频走网络，不缓存）
 *
 * 为什么 .js/.css 不能用「缓存优先」：
 *   一开始这里就是缓存优先，结果是 —— 页面导航走网络拿到了新的 index.html，
 *   而 app.js 永远从缓存里取旧版。两者不匹配轻则功能失效，重则整页白屏，
 *   而且只有已经装到手机上的人才会中招，本机开发完全看不出来。
 *   「改完记得手动把 VERSION 加一」不算解决方案，那是个人肉定时炸弹。
 *
 * VERSION 的作用现在只剩：换新缓存桶、清掉过期的旧桶。
 * 它不是更新能否生效的前提，忘了改也只是多留一份旧缓存而已。
 */
var VERSION = 'v2';
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

/** 网络优先：拿到就顺手更新缓存；失败则回退缓存 */
function networkFirst(req, fallbackKey) {
  return fetch(req)
    .then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (r) {
        if (r) return r;
        return fallbackKey ? caches.match(fallbackKey) : undefined;
      });
    });
}

/** 缓存优先：命中就直接给，没命中再走网络 */
function cacheFirst(req) {
  return caches.match(req).then(function (cached) {
    if (cached) return cached;
    return fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

/** 先给缓存，后台悄悄更新 */
function staleWhileRevalidate(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) c.put(req, res.clone());
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // 发音音频等外部资源不碰

  var pathname = url.pathname;

  // 页面导航：网络优先，断网回退到缓存的首页
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // 词库：先给缓存，后台更新
  if (pathname.endsWith('words.json')) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 代码与样式：网络优先 —— 这里必须新，否则新旧版本混用会白屏
  if (/\.(?:js|css)$/i.test(pathname)) {
    e.respondWith(networkFirst(req));
    return;
  }

  // 字体、图标：缓存优先
  if (/\.(?:woff2?|png|jpg|jpeg|svg|ico)$/i.test(pathname)) {
    e.respondWith(cacheFirst(req));
    return;
  }

  e.respondWith(networkFirst(req));
});
