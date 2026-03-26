/**
 * Service Worker — RUN & TRAIL VM
 * Estrategia: Cache-First para assets estáticos, Network-First para datos dinámicos
 */

const CACHE_NAME    = 'run-trail-vm-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&family=Space+Mono:wght@400;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Instalar: cachear assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

// Activar: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: estrategia por tipo de request
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests no-GET y extensiones de Chrome
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Network-First para Firebase, Strava, APIs externas
  const isApi = url.hostname.includes('firestore.googleapis.com') ||
                url.hostname.includes('firebase') ||
                url.hostname.includes('strava.com') ||
                url.hostname.includes('cloudfunctions.net') ||
                url.hostname.includes('workers.dev');
  if (isApi) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        JSON.stringify({ error: 'offline' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Cache-First para assets estáticos (fuentes, leaflet, imágenes)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        return response;
      }).catch(() => {
        // Fallback para navegación: devolver index.html cacheado
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 408 });
      });
    })
  );
});
