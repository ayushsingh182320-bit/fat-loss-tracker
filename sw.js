/* Offline-first service worker. Bump CACHE_VERSION whenever any app file changes. */
'use strict';

const CACHE_VERSION = 'flt-v1';

// Every file the app needs. Relative to this script's location (the app scope).
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icon-180.png',
  'icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' bypasses the HTTP cache so we store fresh copies.
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        // Not in cache: try the network; for page navigations fall back to the cached app shell.
        return fetch(req).catch(() =>
          req.mode === 'navigate'
            ? cache.match('./').then((shell) => shell || cache.match('index.html'))
            : Response.error()
        );
      })
    )
  );
});
