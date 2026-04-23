/// <reference lib="webworker" />

const CACHE_NAME = 'alcheme-v1';
const STATIC_ASSETS = [
    '/',
    '/home',
    '/circles',
    '/notifications',
    '/profile',
    '/compose',
    '/manifest.json',
];

declare const self: ServiceWorkerGlobalScope;

// Install — cache shell
self.addEventListener('install', (event: ExtendableEvent) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch — network-first for pages, cache-first for static
self.addEventListener('fetch', (event: FetchEvent) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET and external
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    // HTML pages — network-first with cache fallback
    if (request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request).then((r) => r || caches.match('/') as Promise<Response>))
        );
        return;
    }

    // Static assets — cache-first
    if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/icons/')) {
        event.respondWith(
            caches.match(request).then(
                (cached) => cached || fetch(request).then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
            )
        );
        return;
    }
});

export { };
