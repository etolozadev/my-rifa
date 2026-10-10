// Service worker de mis-rifas: hace que la app se pueda instalar y que abra aunque falle la conexión.
// - /api nunca se guarda: los datos siempre vienen frescos (sin conexión, la app muestra su aviso de error).
// - Archivos con hash (/assets/…): no cambian nunca; se guardan la primera vez y después salen del caché.
// - Páginas: primero la red, para tener siempre la última versión; sin conexión, la última copia guardada.
// - Íconos y manifiesto: la copia guardada al tiro, y se actualiza por detrás.
const VERSION = 'v1';
const SHELL = `mis-rifas-shell-${VERSION}`;
const ASSETS = `mis-rifas-assets-${VERSION}`;
// Tope de archivos con hash guardados: cada despliegue trae nombres nuevos y los viejos se van borrando
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mis-rifas-') && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)));
}

/** Guarda una copia de la respuesta (si salió bien) sin demorar la entrega */
function keep(cacheName, key, res, after) {
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(cacheName).then((cache) => cache.put(key, copy).then(() => after && after(cache)));
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Todas las rutas del front entregan el mismo index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => keep(SHELL, '/index.html', res))
        .catch(() => caches.match('/index.html', { cacheName: SHELL })),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(req, { cacheName: ASSETS }).then((hit) => hit || fetch(req).then((res) => keep(ASSETS, req, res, trim))));
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: SHELL }).then((hit) => {
      const fresh = fetch(req).then((res) => keep(SHELL, req, res));
      if (!hit) return fresh;
      fresh.catch(() => {}); // sin conexión basta con la copia guardada
      return hit;
    }),
  );
});
