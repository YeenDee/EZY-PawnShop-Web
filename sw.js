// Self-destructing PWA Service Worker to purge all cached pages and reload fresh assets
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => {
      return self.registration.unregister();
    }).then(() => {
      return self.clients.matchAll();
    }).then((clients) => {
      clients.forEach((client) => {
        if (client.url) {
          try {
            client.navigate(client.url);
          } catch(err) {
            console.error(err);
          }
        }
      });
    })
  );
});

self.addEventListener('fetch', (e) => {
  // Let network handle all requests directly without cache interception
  e.respondWith(fetch(e.request));
});
