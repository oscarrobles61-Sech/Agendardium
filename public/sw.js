/*
 * Service worker de la agenda: muestra los avisos push en la barra de notificaciones
 * y, al tocarlos, abre la agenda en la pestaña Avisos.
 * No guarda nada en caché: la agenda siempre se carga desde el servidor.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { title: 'Aviso', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Aviso de la agenda';
  e.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: true,
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      data: { url: d.url || '/', id: d.id }
    });
    // Si la agenda está abierta, que actualice la bandeja enseguida.
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach(c => c.postMessage({ type: 'aviso', id: d.id }));
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = new URL(data.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      try { await c.focus(); } catch (er) {}
      c.postMessage({ type: 'abrir-aviso', id: data.id });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// Si el navegador renueva la suscripción, la agenda la vuelve a registrar al abrirse.
self.addEventListener('pushsubscriptionchange', () => {});
