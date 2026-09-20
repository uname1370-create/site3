// ---------------------------------------------------------------------------
// sw.js — service worker for the عسل رجبی PMU PWA.
//  - precaches the app shell (works offline after first visit)
//  - navigations: network-first, falls back to the cached shell
//  - same-origin assets: cache-first
//  - cross-origin CDN assets (fonts, Tailwind, MediaPipe): stale-while-revalidate
// ---------------------------------------------------------------------------

const CACHE = "asar-v3";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-180.png",
  "asalrajabi.png",
  "m2.png",
  "m3.png",
  "js/tryon/app.js",
  "js/tryon/workers/client.js",
  "js/tryon/workers/tryon.worker.js",
  "js/tryon/faceAnalyzer.js",
  "js/tryon/pipeline.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Navigations: fresh from network, offline → cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("index.html").then((h2) => h2 || caches.match("./")))
        )
    );
    return;
  }

  // Same-origin: cache-first (immutable-ish assets).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
      )
    );
    return;
  }

  // Cross-origin CDN: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok && (res.type === "basic" || res.type === "cors")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
