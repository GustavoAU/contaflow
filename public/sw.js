// ContaFlow Service Worker — Fase 27 PWA
// Estrategia: CacheFirst para estáticos, NetworkFirst para navegación,
// skip total para API/Server Actions (no cachear datos financieros).

const CACHE_VERSION = "v1";
const STATIC_CACHE = `contaflow-static-${CACHE_VERSION}`;
const SHELL_CACHE = `contaflow-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

const ALL_CACHES = [STATIC_CACHE, SHELL_CACHE];

// ── Install: pre-cachear solo la página offline ───────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches de versiones anteriores ─────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => !ALL_CACHES.includes(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo GET del mismo origen
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Nunca interceptar: API routes, Server Actions (_next/data, Next RSC payload)
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/data/") ||
    url.searchParams.has("_rsc")
  )
    return;

  // ── Estáticos de Next.js → Cache First (inmutables por hash en nombre) ──
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Íconos y assets públicos → Cache First ──────────────────────────────
  if (url.pathname.startsWith("/icons/") || url.pathname.match(/\.(png|svg|ico|woff2?)$/)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Navegación → Network First con fallback a /offline ──────────────────
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}
