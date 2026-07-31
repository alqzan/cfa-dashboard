"use strict";
/* CFA Personal Coach v6 — service worker.
   Goal: the app keeps working after the tab is closed and reopened with no network, without
   ever silently trapping the user on a stale build. Rules that shape everything below:
     - Never call skipWaiting() automatically. A new version installs and WAITS; the user only
       gets moved onto it when they press "التحقق من وجود تحديث" and confirm — see app.js's
       checkForUpdate(). No surprise reloads, no silently-stuck-on-old-code either.
     - HTML is always network-first (so a user who IS online always gets the latest app shell),
       falling back to the cache only when the network is unavailable — that's what makes
       "works offline after first load" true without also making "always shows day-old UI when
       online" true.
     - Static assets (css/js/icons) are cache-first with a background revalidate, since they're
       already version-querystringed (?v=6.0.0) from index.html — a real version bump changes
       that querystring, which is effectively a new URL, so there's no staleness risk there.
     - Cross-origin requests (fonts, gstatic Firebase SDK, Firestore) are never intercepted —
       this worker only ever caches this app's own files. */
const CACHE_NAME = "cfa-coach-v6.0.0";
const CORE_ASSETS = [
  "./", "./index.html", "./manifest.json",
  "./assets/css/app.css?v=6.0.0",
  "./assets/js/readiness.js?v=6.0.0",
  "./assets/js/app.js?v=6.0.0",
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
