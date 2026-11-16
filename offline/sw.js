// Service Worker：离线缓存应用外壳，安装后完全离线可玩
const CACHE_NAME = 'gomoku-offline-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './ai.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.png',
];

// 安装：预缓存全部资源
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 请求策略：
// - 页面导航（index.html）：网络优先，离线才回退缓存 → 保证发版后立刻拿到新 HTML
// - 其他静态资源（js/css）：缓存优先 + 后台更新 → 保证离线可玩
//   （HTML 里的资源带 ?v= 版本号，新 HTML 会自然拉到新资源，不会命中旧缓存）
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isNav = req.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('index.html');

  if (isNav) {
    e.respondWith(
      fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() =>
        caches.match(req).then(c => c || caches.match('./index.html'))
      )
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return response;
      }).catch(() => cached); // 完全离线时回退到缓存
      return cached || fetchPromise;
    })
  );
});
