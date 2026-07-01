/**
 * Service Worker — Estudio Jurídico Arenas CRM
 *
 * Strategy:
 *   - App shell (JS/CSS/fonts): Cache-first with background update
 *   - API calls (supabase, groq): Network-first, no cache
 *   - Navigation: Network-first, fallback to cached index
 */

const CACHE_NAME = "crm-arenas-v1";
const STATIC_ASSETS = ["/", "/login"];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => {
        // Fail silently — network may not be available at install time
      })
    )
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept: Supabase API, Groq AI, Google APIs, external resources
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("groq.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("google.com") ||
    url.hostname.includes("fonts.g") ||
    request.method !== "GET"
  ) {
    return; // Let browser handle it normally
  }

  // Static assets (JS, CSS, images): cache-first
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".woff2")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) =>
                cache.put(request, response.clone())
              );
            }
            return response;
          })
          .catch(() => cached); // offline fallback
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Navigation requests: network-first, fallback to cached "/"
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/").then((cached) => cached || Response.error())
      )
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((r) => r || Response.error()))
  );
});
