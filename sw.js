/* M8 service worker — network-first (no stale theme), offline shell fallback. */
const CACHE = 'm8-shell-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      try { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); } catch (_) {}
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});

/* Web Push — task reminders (build #4). */
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { try { data = { body: e.data.text() }; } catch (__) { data = {}; } }
  var title = data.title || 'M8';
  var opts = {
    body: data.body || '',
    icon: '/icons/icon-192-v2.png',
    badge: '/icons/icon-192-v2.png',
    data: { url: data.url || '/' },
    tag: 'm8-task-due',
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(url) >= 0 && 'focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
