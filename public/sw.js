/*
 ╔══════════════════════════════════════════════════════════════════════╗
 ║   PADMAVATHI FRUITS — Service Worker v5                             ║
 ║   FIX: chrome-extension:// TypeError resolved                       ║
 ║   PERF: Network-first for API, Cache-first for assets               ║
 ╚══════════════════════════════════════════════════════════════════════╝
*/

const CACHE_NAME    = 'pfc-v5';
const STATIC_CACHE  = 'pfc-static-v5';
const API_CACHE     = 'pfc-api-v5';

// ─── Assets to pre-cache on install ────────────────────────────────
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
];

// ─── INSTALL: Pre-cache static assets ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: Clean up old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH: The critical handler with scheme guard ─────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // ═══════════════════════════════════════════════════════════════
  //  🔴 FIX — SKIP non-http(s) schemes COMPLETELY
  //  Root cause of: TypeError: Failed to execute 'put' on 'Cache':
  //  Request scheme 'chrome-extension' is unsupported
  //  Also covers: moz-extension://, safari-extension://, data://, blob://
  // ═══════════════════════════════════════════════════════════════
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return; // Let the browser handle it natively — don't intercept
  }

  // Skip non-GET requests — only cache GET
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests except CDN assets we want to cache
  const isSameOrigin = url.startsWith(self.location.origin);
  const isTrustedCDN = url.includes('fonts.googleapis.com') ||
                       url.includes('fonts.gstatic.com') ||
                       url.includes('cdnjs.cloudflare.com');

  // ─── API routes: Network-first, no caching ──────────────────────
  // Prevents stale product/price data being served from cache
  if (url.includes('/api/') || url.includes('/.netlify/functions/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response(
          JSON.stringify({ ok: false, message: 'You are offline. Please check your connection.' }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // ─── Fonts & CDN: Cache-first (long-lived, never changes) ────────
  if (isTrustedCDN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // ─── Same-origin assets: Stale-while-revalidate ──────────────────
  // Serves from cache instantly, updates cache in background
  if (isSameOrigin) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache => {
        return cache.match(event.request).then(cached => {
          const networkFetch = fetch(event.request).then(response => {
            // Only cache valid responses
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached); // Network failed → use cache

          // Return cached immediately, update in background
          return cached || networkFetch;
        });
      })
    );
    return;
  }
});

// ─── PUSH NOTIFICATIONS ────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  const title   = data.title   || 'Padmavathi Fruits 🍎';
  const options = {
    body:    data.body    || 'You have a new notification.',
    icon:    data.icon    || '/favicon.ico',
    badge:   data.badge   || '/favicon.ico',
    tag:     data.tag     || 'pfc-push',
    vibrate: [200, 100, 200],
    data:    { url: data.url || '/' },
    actions: data.actions || [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── NOTIFICATION CLICK ────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});