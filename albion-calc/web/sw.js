/* Offline shell: cache the app files, never cache API calls. */
const CACHE = 'albion-calc-v3';
const FILES = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'data/names.js', 'data/recipes.js', 'data/meta.js', 'data/flip.js', 'data/journals.js', 'data/extras.js',
  'js/core.js', 'js/ui.js', 'js/common.js', 'js/app.js',
  'js/tools/flipper.js', 'js/tools/planner.js', 'js/tools/refining.js', 'js/tools/consumable.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // API + icons go straight to network
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
