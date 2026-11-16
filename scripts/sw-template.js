/* Covison Pocket service worker. Generated at build time from
 * scripts/sw-template.js; do not edit dist/sw.js by hand.
 *
 * Strategy
 * - install: precache the whole app shell (every file in dist/) into a
 *   cache named after a hash of all file contents. If any file fails, the
 *   install fails and the old version keeps running (safe update).
 * - activate: delete caches from older versions, claim open pages.
 * - fetch: same-origin GET only. Cache first; navigations fall back to the
 *   cached index.html so deep links work offline. Nothing ever goes to
 *   another origin.
 * - update: the new worker waits until the page asks it to take over
 *   (postMessage "SKIP_WAITING" from the "Update available" toast).
 */
const VERSION = "__VERSION__";
const CACHE = `covison-pocket-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("covison-pocket-") && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "GET_VERSION" && event.source) {
    event.source.postMessage({ type: "VERSION", version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      // ignoreVary: hosts often send "Vary: Origin", and module scripts are
      // requested in CORS mode (with an Origin header) while the precache
      // requests were not, so a Vary-aware match would miss when offline.
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        const shell = await cache.match("./index.html");
        if (shell && req.mode === "navigate") return shell;
        throw err;
      }
    })(),
  );
});
