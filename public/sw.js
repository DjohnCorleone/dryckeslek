// Service Worker for Fils' Thrill push notifications

self.addEventListener("push", (event) => {
  let data = { title: "Fils' Thrill", body: "Ny runda!" };
  try {
    data = event.data.json();
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23000000'/><text x='50' y='50' text-anchor='middle' dominant-baseline='central' font-size='65'>🦹‍♀️</text></svg>",
      badge: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23000000'/><text x='50' y='50' text-anchor='middle' dominant-baseline='central' font-size='65'>🦹‍♀️</text></svg>",
      vibrate: [200, 100, 200],
      tag: "fils-thrill-round",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow("/");
    })
  );
});
