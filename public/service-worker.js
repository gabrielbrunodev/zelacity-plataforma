const CACHE_NAME = 'zelacity-static-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/acompanhar.html',
  '/login.html',
  '/painel.html',
  '/manutencao.html',
  '/ordens-servico.html',
  '/relatorios.html',
  '/styles.css',
  '/app.js',
  '/acompanhar.js',
  '/login.js',
  '/painel.js',
  '/manutencao.js',
  '/ordens-servico.js',
  '/relatorios.js',
  '/pwa.js',
  '/manifest.json',
  '/assets/app-icon.svg',
  '/assets/zelacity-logo.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => null);
      event.waitUntil(refresh);
      return cached || refresh.then((response) => response || new Response('', { status: 503, statusText: 'Offline' }));
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Zelacity Plataforma', body: 'Há uma atualização disponível.' };
  try { payload = { ...payload, ...(event.data?.json() || {}) }; } catch { payload.body = event.data?.text() || payload.body; }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/assets/app-icon.svg',
    badge: '/assets/app-icon.svg',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'));
});
