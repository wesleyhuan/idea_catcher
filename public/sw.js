// Pages and build assets live in separate caches so trimming assets never
// evicts the offline copies of the pages. Bump the version to drop both.
const PAGES = 'idea-catcher-pages-v2';
const ASSETS = 'idea-catcher-assets-v2';
const KEEP = [PAGES, ASSETS];
// Each deploy brings new content-hashed chunks and the old ones are never
// requested again, so without a cap the asset cache only grows.
const MAX_ASSETS = 150;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  // Removes caches from earlier versions (including 'idea-catcher-v1').
  const names = await caches.keys();
  await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
  await self.clients.claim();
})()));

/** Deletes the oldest entries (cache.keys() is in insertion order) beyond `max`. */
async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

function putInCache(name, request, response) {
  const copy = response.clone();
  caches.open(name)
    .then(async (cache) => {
      await cache.put(request, copy);
      if (name === ASSETS) await trim(cache, MAX_ASSETS);
    })
    .catch((err) => console.error('[sw] cache put failed', err));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: network first, cached copy when offline. Redirects are never cached (Safari rejects them).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !res.redirected) putInCache(PAGES, request, res);
          return res;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match('/')) ?? Response.error()),
    );
    return;
  }

  // Build assets are content-hashed: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
        if (res.ok) putInCache(ASSETS, request, res);
        return res;
      })),
    );
  }
});
