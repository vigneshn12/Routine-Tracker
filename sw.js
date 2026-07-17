/* Service worker: makes the tracker work offline once installed.
 *
 * Strategy is stale-while-revalidate — serve the cached copy immediately (so the
 * app opens instantly and works with no signal), then refresh the cache from the
 * network in the background. Edits to the app land on the next launch without
 * needing a version bump here.
 *
 * Your routine data is NOT here: it lives in localStorage, which the browser
 * keeps independently of this cache. Clearing the cache never loses your data.
 */

// Bumped to v2: drops the tasks.json entry cached by v1.
const CACHE = 'routine-tracker-v2';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Add individually: one missing file shouldn't fail the whole install.
    await Promise.all(ASSETS.map(url =>
      cache.add(new Request(url, { cache: 'reload' }))
        .catch(err => console.warn('[sw] could not cache', url, err))
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Never touch non-GET or cross-origin requests.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);

    const network = fetch(request).then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    // Cached copy first; otherwise wait for the network.
    const response = cached || await network;
    if (response) return response;

    // Offline with nothing cached: a navigation should still land on the app.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
