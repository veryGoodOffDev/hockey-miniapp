self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'Новое сообщение';
  const body = data.body || 'Откройте приложение, чтобы прочитать';
  const url = data.url || '/';
  const unreadCount = Number(data.unreadCount || 0);

  const showPromise = self.registration.showNotification(title, {
    body,
    icon: '/web-app-manifest-192x192.png',
    badge: '/web-app-manifest-192x192.png',
    data: { url, unreadCount },
    tag: 'chat-message',
    renotify: true,
  });

  event.waitUntil((async () => {
    await showPromise;
    if ('setAppBadge' in self.navigator) {
      if (unreadCount > 0) await self.navigator.setAppBadge(unreadCount);
      else if ('clearAppBadge' in self.navigator) await self.navigator.clearAppBadge();
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        client.postMessage({ type: 'push-open-url', url });
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
