/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// Application disponible hors connexion.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Photos des produits : mises en cache (consultables hors connexion).
registerRoute(
  ({ url }) => /^\/api\/(households\/[^/]+\/photos\/|barcode\/[^/]+\/image)/.test(url.pathname),
  new CacheFirst({ cacheName: 'homeos-photos', plugins: [new ExpirationPlugin({ maxEntries: 800, maxAgeSeconds: 90 * 86400 })] }),
);

// Moteurs lourds (lecture de codes, OCR) chargés à la demande puis conservés.
registerRoute(
  ({ url }) => url.pathname.startsWith('/engines/'),
  new CacheFirst({ cacheName: 'homeos-engines', plugins: [new ExpirationPlugin({ maxEntries: 20 })] }),
);

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// Notifications push (récapitulatifs, alertes importantes).
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'HOMEOS', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag,
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          void (c as WindowClient).navigate(url);
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
