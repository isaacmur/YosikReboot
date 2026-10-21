// YosikReboot service worker (F34). Keeps the app shell (page, scripts, styles,
// fonts, icons) so the app opens at once and can be installed to a home screen.
// It never touches /api/*: Epic data always comes from the network, through the
// passphrase gate. vite.config.ts fills in this build's files and version.

const CACHE = 'yr-shell-__VERSION__';
const SHELL = ['__SHELL__'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

// A new build replaces the old shell as soon as it's installed.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('yr-shell-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    // Network first, so a new deploy shows at once; the saved shell when offline.
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())));
    return;
  }
  // Built files have content hashes in their names, so a saved copy never goes stale.
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});
