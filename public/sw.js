/* Service Worker — Push notification handler for StudyWithMalak */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Display an OS notification when a push message arrives. */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Study Room", body: event.data.text() };
  }
  const title = data.title || "Study Room";
  const icon = data.icon || "avatars/ali.webp";
  const options = {
    body: data.body || "",
    tag: data.tag || "study-push",
    icon,
    badge: data.badge || icon,
    renotify: true,
    requireInteraction: false,
    data: { url: self.registration.scope },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Focus/open the study room when a notification is clicked. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.startsWith(url) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
