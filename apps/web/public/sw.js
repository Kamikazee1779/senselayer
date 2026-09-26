self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clients => {
      if (clients.length > 0) {
        return clients[0].focus();
      }

      return self.clients.openWindow('/');
    })
  );
});

self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'SenseLayer',
      {
        body: data.body || 'You have a new update.',
        tag: data.tag || 'senselayer'
      }
    )
  );
});
