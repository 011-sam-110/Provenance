/* TrafficNerd service worker — installable PWA + offline app shell.
 *
 * HONEST CACHING — the whole point: LIVE DATA IS NEVER CACHED, so what you see is
 * always fresh.
 *   • /api/*            → bypassed entirely (cameras, planes, signals, markets…).
 *   • cross-origin      → bypassed (CARTO/Esri basemap tiles, DEM, webcam images…).
 *   • /_next/static/*   → cache-first (content-hashed, immutable build assets).
 *   • /icons, /textures, /sky → cache-first (static assets).
 *   • navigations (HTML shell) → network-first, fall back to cache only OFFLINE.
 *
 * So offline you get the last app shell, but every data fetch still hits the
 * network (and simply fails offline) — no stale live data is ever served.
 */
const VERSION = "tn-v2";
const SHELL_CACHE = VERSION + "-shell";
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {})),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only same-origin; tiles / CDNs / live cross-origin pass straight through.
  if (url.origin !== self.location.origin) return;
  // NEVER cache live API responses — data must stay fresh + honest.
  if (url.pathname.startsWith("/api/")) return;

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/textures/") ||
    // The star catalogue (/sky/naked-eye.json) is generated offline by a
    // hand-run script and committed, not fetched from a live upstream — it is
    // reference data, not a data feed, so cache-first is honest here the same
    // way it is for /textures.
    url.pathname.startsWith("/sky/");

  if (isStatic) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
  }
});

function cacheFirst(req) {
  return caches.open(SHELL_CACHE).then((cache) =>
    cache.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }),
    ),
  );
}

function networkFirst(req) {
  return caches.open(SHELL_CACHE).then((cache) =>
    fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => cache.match(req).then((hit) => hit || cache.match("/"))),
  );
}
