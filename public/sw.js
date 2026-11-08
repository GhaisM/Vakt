const CACHE_NAME = 'vakter-app-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/vakt-icon.svg', '/vakt-icon-192.png', '/vakt-icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(APP_SHELL);
      const indexResponse = await cache.match('/index.html');
      if (indexResponse) {
        const indexHtml = await indexResponse.text();
        const foundAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+[.](?:js|css)(?:[?][^"]*)?)"/g)]
          .map(match => match[1])
          .filter(path => new URL(path, self.location.origin).origin === self.location.origin)
          .map(path => new URL(path, self.location.origin).href);
        if (foundAssets.length) await cache.addAll(foundAssets);
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('vakter-app-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/index.html'))
    );
    return;
  }

  if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
