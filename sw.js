// App-shell cache (PLAN.md increment 3): cache-first for same-origin static
// files, so the board still *opens* if iOS killed the tab in a dead zone.
// Queued play (increment 2's offline queue) picks up from there — this file
// only makes the shell load; it has no game logic.
const CACHE_NAME = 'trb-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './js/config.js',
  './js/supabase.js',
  './js/state.js',
  './js/claims.js',
  './js/ui.js',
  './icons/icon-180.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for everything GET, same-origin or not (the CDN scripts for
// Tailwind and supabase-js are just as load-bearing as our own files — a
// cached copy beats a network error every time). Non-GET requests (the
// Supabase REST/realtime traffic) pass straight through untouched.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => cached); // offline and not cached — let it fail naturally
    })
  );
});
