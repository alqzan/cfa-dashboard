"use strict";
/* Simple CFA Study Tracker v7 — service worker.
   Keeps the app usable offline after the first load. HTML is network-first so an online
   user always gets the latest build; static assets are cache-first with revalidate since
   they're version-querystringed from index.html. Cross-origin requests (fonts) are never
   intercepted — this worker only ever caches this app's own files. */
const CACHE_NAME = "cfa-tracker-v7.12.0";
const CORE_ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./assets/css/app.css?v=7.12.0",
  "./assets/js/app.js?v=7.12.0",
  "./assets/js/sync.js?v=7.12.0",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((err) => console.warn("SW install: some core assets failed to pre-cache", err))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* let fonts/Firebase requests pass through untouched */

  const isNavigation = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  event.respondWith(isNavigation ? networkFirst(req) : staleWhileRevalidate(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) { const cache = await caches.open(CACHE_NAME); cache.put(req, res.clone()); }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    return cached || caches.match("./index.html");
  }
}
async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
    return res;
  }).catch(() => null);
  return cached || (await network) || fetch(req);
}
