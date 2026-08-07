const CACHE_PREFIX = 'golf-shell-';
const META_CACHE = 'golf-cache-meta';
const META_BASE = new URL('./__golf_cache__/', self.location.href).href;
const SHELL = [
  './',
  './index.html',
  './src/scoring.js',
  './src/storage.js',
  './src/live-sync.js',
  './src/validation.js',
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
    const hit = cache && await cache.match(event.request);
    if (hit) return hit;
    const response = await fetch(event.request);
    if (cache && response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
