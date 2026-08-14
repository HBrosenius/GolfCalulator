const CACHE_PREFIX = 'golf-shell-';
const META_CACHE = 'golf-cache-meta';
const META_BASE = new URL('./__golf_cache__/', self.location.href).href;
const NOTIFICATION_HISTORY_KEY = META_BASE + 'notification-history';
const SHELL = [
  './',
  './index.html',
  './src/vendor/dompurify.min.js?v=3.4.13',
  './src/scoring.js?v=20260809-2',
  './src/storage.js?v=20260809-2',
  './src/live-sync.js?v=20260809-2',
  './src/validation.js?v=20260809-2',
  './src/round-extras.js?v=20260809-2',
  './src/live-round.js?v=20260809-2',
  './src/tour-rules.js?v=20260809-3',
  './src/tour-sync.js?v=20260809-7',
  './src/account-sync.js?v=20260809-7',
  './src/course-catalog.js?v=20260814-1',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

async function readCachePointer(name) {
  const meta = await caches.open(META_CACHE);
  const response = await meta.match(META_BASE + name);
  return response ? response.text() : null;
}

async function writeCachePointer(name, value) {
  const meta = await caches.open(META_CACHE);
  await meta.put(META_BASE + name, new Response(value));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cacheName = CACHE_PREFIX + crypto.randomUUID();
    const cache = await caches.open(cacheName);
    await cache.addAll(SHELL);
    await writeCachePointer('pending', cacheName);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const pending = await readCachePointer('pending');
    const current = pending || await readCachePointer('current');
    if (pending) {
      await writeCachePointer('current', pending);
      const meta = await caches.open(META_CACHE);
      await meta.delete(META_BASE + 'pending');
    }
    if (current) {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter(key => (key.startsWith(CACHE_PREFIX) || /^golf-v\d+$/.test(key)) && key !== current)
        .map(key => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_NOTIFICATION_HISTORY') event.waitUntil((async () => {
    const meta = await caches.open(META_CACHE);
    const response = await meta.match(NOTIFICATION_HISTORY_KEY);
    const history = response ? await response.json().catch(() => []) : [];
    event.ports?.[0]?.postMessage(Array.isArray(history) ? history : []);
  })());
  if (event.data && event.data.type === 'CLEAR_NOTIFICATION_HISTORY') event.waitUntil(
    caches.open(META_CACHE).then(cache => cache.delete(NOTIFICATION_HISTORY_KEY))
  );
});

async function rememberNotification(data) {
  const meta = await caches.open(META_CACHE);
  const response = await meta.match(NOTIFICATION_HISTORY_KEY);
  const history = response ? await response.json().catch(() => []) : [];
  const item = {
    id: crypto.randomUUID(), title: String(data.title || 'Poängbogey').slice(0, 120),
    body: String(data.body || 'En delad tour har uppdaterats.').slice(0, 300),
    url: String(data.url || './index.html').slice(0, 500), at: Date.now(),
  };
  await meta.put(NOTIFICATION_HISTORY_KEY, Response.json([item, ...(Array.isArray(history) ? history : [])].slice(0, 50)));
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) {}
    await rememberNotification(data);
    await self.registration.showNotification(data.title || 'Poängbogey', {
      body: data.body || 'En delad tour har uppdaterats.', icon: './icon-192.png', badge: './icon-192.png',
      tag: data.tag || 'golf-tour', data: { url: data.url || './index.html' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || './index.html', self.location.href).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows[0];
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});

async function currentCache() {
  const cacheName = await readCachePointer('current');
  return cacheName ? caches.open(cacheName) : null;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await currentCache();
      try {
        const response = await fetch(event.request);
        if (cache) await cache.put('./index.html', response.clone());
        return response;
      } catch (error) {
        const fallback = cache && await cache.match('./index.html');
        if (fallback) return fallback;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await currentCache();
    if (event.request.destination === 'script') {
      try {
        const response = await fetch(event.request);
        if (cache && response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const fallback = cache && await cache.match(event.request);
        if (fallback) return fallback;
        throw error;
      }
    }
    const hit = cache && await cache.match(event.request);
    if (hit) return hit;
    const response = await fetch(event.request);
    if (cache && response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
