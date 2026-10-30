/* Only public app-shell resources belong in this cache, never private data. */
const CACHE_PREFIX = 'sideline-pwa-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_FILES = ['/', '/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg', '/icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(
    SHELL_FILES.map((path) => cache.add(new Request(path, { credentials: 'omit', cache: 'reload' }))),
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // Do not retain a viewer-token path, a query string, or its response.
        if (url.pathname === '/' && !url.search && response.ok) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('/', response.clone());
          } catch { /* Cache quota failures must not break an online load. */ }
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/')) ?? new Response('You are offline. Reconnect to load Sideline.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  const immutableAsset = /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|svg|png|jpe?g|webp|avif)$/.test(url.pathname);
  const shellAsset = SHELL_FILES.includes(url.pathname) && url.pathname !== '/';
  if (url.search || (!immutableAsset && !shellAsset)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        } catch { /* Storage is optional; the fetched asset is still usable. */ }
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request)) ?? new Response('', { status: 503 });
    }
  })());
});
