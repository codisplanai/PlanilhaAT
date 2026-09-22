const CACHE_VERSION = 'planaut-pwa-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/favicon.svg',
  '/planaut-icon.svg',
  '/icons/pwa-192x192.svg',
  '/icons/pwa-512x512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('planaut-pwa-') && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/v1/') ||
    url.pathname === '/runtime-config.js' ||
    url.pathname === '/docs' ||
    url.pathname === '/openapi.json' ||
    url.pathname === '/redoc'
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          // O precache pode ter falhado; devolver undefined faria o
          // respondWith lançar em vez de mostrar um erro compreensível.
          return offline || new Response(
            '<!doctype html><meta charset="utf-8"><title>PlanAut offline</title>'
            + '<p style="font-family:sans-serif;padding:2rem">Sem conexao com o servidor. '
            + 'Verifique sua internet e recarregue a pagina.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        }),
    );
    return;
  }

  const destination = request.destination;
  const isStaticAsset = ['script', 'style', 'image', 'font'].includes(destination)
    || url.pathname.startsWith('/assets/')
    || url.pathname === '/manifest.webmanifest';

  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // respondWith rejeita um valor indefinido: sem cache e sem rede, o
          // navegador precisa de uma resposta real para falhar com clareza.
          if (cached) return cached;
          return new Response('', {
            status: 504,
            statusText: 'Recurso indisponível offline',
          });
        });

      return cached || network;
    }),
  );
});
