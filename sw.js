// Focus Player service worker: makes the app open offline.
// After a bigger update, raise the number in CACHE so old files are cleared.
const CACHE = 'focus-player-v3';
const CORE = ['./', './index.html', './styles.css', './app.js', './db.js', './tone.js', './reorder.js',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const NETWORK_WAIT = 3000; // ms to wait for a fresh copy before opening the saved one

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

// Fresh copy from the network when it arrives within 3 seconds; otherwise the saved copy,
// so a weak signal never holds up the launch. A late network answer still refreshes the cache.
function networkWithTimeout(req) {
  const fromNetwork = fetch(req).then((res) => putInCache(req, res));
  const fromCache = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (p) => p.then((r) => { if (!settled && r) { settled = true; resolve(r); } });
    const timer = setTimeout(() => finish(fromCache()), NETWORK_WAIT);
    fromNetwork
      .then((res) => { clearTimeout(timer); if (!settled) { settled = true; resolve(res); } })
      .catch(() => { clearTimeout(timer); finish(fromCache()).then(() => { if (!settled) { settled = true; resolve(Response.error()); } }); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.protocol === 'blob:') return;
    e.respondWith(networkWithTimeout(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Fonts rarely change: cache first.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => putInCache(req, res))));
  }
});
