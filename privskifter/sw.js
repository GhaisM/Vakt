const CACHE_NAME = 'kalkulator-cache-v1';
const filerÅLagre = [
  './index.html',
  // Skriv inn CSS- og JS-filene dine her, f.eks:
  // './style.css',
  // './script.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(filerÅLagre))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});