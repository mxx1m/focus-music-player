// Focus Player service worker: makes the app open offline.
// After a bigger update, raise the number in CACHE so old files are cleared.
const CACHE = 'focus-player-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Only remove this app's old caches; other apps on the same github.io address keep theirs.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('focus-player-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Network first, so a new version shows up on the next launch; the cache is the offline fallback.
    e.respondWith(
      fetch(req).then((res) => putInCache(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Fonts rarely change: cache first.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => putInCache(req, res))));
  }
});
