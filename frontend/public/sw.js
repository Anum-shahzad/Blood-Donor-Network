/* Blood Donor Network service worker: Web Push + notification clicks only.
   It deliberately has NO fetch handler and caches nothing, so it can never
   serve stale pages or interfere with the app or API. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Urgent blood request', body: 'Open the app to view it.' };
  }
  const title = data.title || 'Urgent blood request';
  const urgent = data.urgency === 'critical' || data.urgency === 'high';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/images/favicon.svg',
      badge: '/images/favicon.svg',
      // Same tag as the in-page notification: one alert shows once per device.
      tag: data.tag || 'bdn-alert',
      renotify: false,
      requireInteraction: urgent,
      data: { url: data.url || '/donor/dashboard?tab=tab-feed', notificationId: data.notificationId },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever open a path on this site.
  let target = '/donor/dashboard?tab=tab-feed';
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || target, self.location.origin);
    if (u.origin === self.location.origin) target = u.pathname + u.search + u.hash;
  } catch { /* keep default */ }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          try {
            await client.focus();
            if ('navigate' in client) await client.navigate(target);
            return;
          } catch { /* fall through to openWindow */ }
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
