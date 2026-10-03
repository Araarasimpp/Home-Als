/* Home ALS: service worker de avisos (notificaciones push).
 * Lo mantiene vivo el navegador aunque la app esté cerrada: recibe el aviso
 * que envía Supabase y lo muestra como notificación del sistema.
 * No guarda caché ni intercepta peticiones: solo maneja avisos.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (e) {
    datos = { titulo: 'Home ALS', cuerpo: event.data ? event.data.text() : '' };
  }

  const titulo = datos.titulo || 'Home ALS';
  const opciones = {
    body: datos.cuerpo || '',
    icon: '/assets/icon/logo-192.png',
    badge: '/assets/icon/favicon.png',
    // Mismo "tag" que usa la app abierta: si ambos muestran el aviso, uno reemplaza al otro
    tag: datos.tag || undefined,
    renotify: !!datos.tag,
    data: { url: datos.url || '/' },
    vibrate: [120, 60, 120],
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

// Al tocar el aviso: si la app ya está abierta, la enfoca y navega; si no, la abre
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if (new URL(v.url).origin === self.location.origin) {
          return v.focus().then((enfocada) => (enfocada && 'navigate' in enfocada ? enfocada.navigate(destino) : null));
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
