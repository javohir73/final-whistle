/* FinalWhistle service worker — installability + safe offline support.
 *
 * Caching contract (schema 4):
 *   - /backend-api/* is NEVER touched. The backend proxy is SAME-origin (a
 *     Next.js rewrite), so an origin check is not enough — auth, live scores,
 *     tips and leaderboard data must always hit the network.
 *   - Page navigations are network-first with a 4 s budget: navigation
 *     preload starts the request while the worker boots, and if the network
 *     hasn't answered in NAV_TIMEOUT_MS the last cached copy of that page is
 *     served instead (the network response still refreshes the cache when it
 *     lands). Offline, or with no cached copy and a failed request, the
 *     offline page. Pages live in their own LRU cache capped at MAX_PAGES.
 *   - Hashed build assets (/_next/static/*) are immutable: cache-first, in a
 *     separate cache capped at MAX_STATIC.
 *   - Unhashed images (/clubs, /competitions, icons, flags) are
 *     stale-while-revalidate, capped at MAX_ASSETS, so a replaced badge
 *     reaches existing installs on the next visit instead of never.
 *   - Everything else (RSC ?_rsc= payloads, /_next/image, the manifest,
 *     analytics beacons) passes through untouched — caching those froze page
 *     data in fw-v1.
 *   - Only same-origin res.ok responses are cached, so a 401/404/500 can
 *     never be replayed (fw-v1 cached a 401 /auth/me, which made signed-in
 *     users look logged out after refresh).
 *
 * Versioning — how caches get replaced:
 *   - Every deploy: components/ServiceWorker.tsx registers this file as
 *     /sw.js?v=<SW_VERSION>, a build-time constant (schema + the commit SHA
 *     Vercel exposes at build, else the model version). A new URL installs a
 *     new worker; activate then deletes the previous deploy's shell and page
 *     caches, whose HTML points at the old build's chunks. No manual bump.
 *   - Contract changes: bump SCHEMA below AND SW_SCHEMA in
 *     components/ServiceWorker.tsx. That also retires the long-lived static
 *     and asset caches. Any fw-* cache not in the current set is deleted on
 *     activate (this removes fw-v1..fw-v3 from older installs).
 */
const SCHEMA = "4";
const NAV_TIMEOUT_MS = 4000;
const MAX_PAGES = 30;
const MAX_STATIC = 200;
const MAX_ASSETS = 150;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png"];

const IMAGE = /\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif)$/i;

/** The deploy's version, from the ?v= the page registered us with. */
function versionFrom(scriptUrl) {
  try {
    return new URL(scriptUrl).searchParams.get("v") || SCHEMA;
  } catch {
    return SCHEMA;
  }
}

/** Cache names for this worker. Shell and pages are per deploy; hashed static
 *  chunks and public images are only retired by a SCHEMA change. */
function cacheNames(version) {
  return {
    shell: `fw-shell-${version}`,
    pages: `fw-pages-${version}`,
    static: `fw-static-s${SCHEMA}`,
    assets: `fw-assets-s${SCHEMA}`,
  };
}

/** Our caches that the current worker no longer uses. Only fw-* names are
 *  ours to delete. */
function staleCacheKeys(existing, names) {
  const keep = new Set(Object.values(names));
  return existing.filter((key) => key.startsWith("fw-") && !keep.has(key));
}

/** Which strategy a GET request gets: bypass | navigate | static | asset. */
function routeFor(url, mode, origin) {
  if (url.origin !== origin) return "bypass"; // flags CDN, Sentry, Stripe
  if (url.pathname.startsWith("/backend-api/")) return "bypass";
  if (mode === "navigate") return "navigate";
  if (url.pathname.startsWith("/_next/static/")) return "static";
  if (url.pathname.startsWith("/_next/")) return "bypass"; // RSC, image optimizer
  if (IMAGE.test(url.pathname)) return "asset";
  return "bypass";
}

/** Only complete same-origin successes are worth replaying later. */
function cacheable(res) {
  return Boolean(res) && res.ok && (res.type === "basic" || res.type === "default");
}

/** Keep the newest `max` entries. Cache.put() re-appends a key, so the order
 *  of cache.keys() is least-recently-stored first: an LRU by last fetch. */
async function trim(cache, max) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function putTrimmed(cacheName, req, res, max) {
  const cache = await caches.open(cacheName);
  await cache.put(req, res);
  await trim(cache, max);
}

const TIMED_OUT = Symbol("timed out");

/** Network-first navigation with a timeout budget and an offline fallback. */
async function navigate(event, names, timeoutMs = NAV_TIMEOUT_MS) {
  const req = event.request;
  let store = Promise.resolve();
  const network = (async () => {
    // Navigation preload already has this request in flight (null/undefined
    // when preload is off or unsupported).
    const res = (await event.preloadResponse) || (await fetch(req));
    if (cacheable(res)) store = putTrimmed(names.pages, req, res.clone(), MAX_PAGES);
    return res;
  })();
  // Extend the event's lifetime synchronously: once a timed-out navigation
  // has been answered from cache, a later waitUntil() would throw
  // InvalidStateError and the late network response would never be stored.
  event.waitUntil(network.then(() => store).catch(() => {}));

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== TIMED_OUT) return first;
    // Slow network: the last good copy now beats a spinner. With nothing
    // cached, keep waiting -- the user is online, just slow.
    const cached = await caches.match(req, { cacheName: names.pages });
    return cached || (await network);
  } catch {
    const cached = await caches.match(req, { cacheName: names.pages });
    return (
      cached ||
      (await caches.match(OFFLINE_URL, { cacheName: names.shell })) ||
      Response.error()
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Hashed, immutable build assets: cache-first. */
async function cacheFirst(event, names) {
  const req = event.request;
  const cached = await caches.match(req, { cacheName: names.static });
  if (cached) return cached;
  const res = await fetch(req);
  if (cacheable(res)) event.waitUntil(putTrimmed(names.static, req, res.clone(), MAX_STATIC));
  return res;
}

/** Unhashed public images: answer from cache, refresh in the background. */
async function staleWhileRevalidate(event, names) {
  const req = event.request;
  let store = Promise.resolve();
  const network = fetch(req).then((res) => {
    if (cacheable(res)) store = putTrimmed(names.assets, req, res.clone(), MAX_ASSETS);
    return res;
  });
  // Synchronous for the same reason as navigate(): the cached answer may
  // settle respondWith long before the refresh lands.
  event.waitUntil(network.then(() => store).catch(() => {}));
  const cached = await caches.match(req, { cacheName: names.assets });
  return cached || network;
}

if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
  const NAMES = cacheNames(versionFrom(self.location.href));

  self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(NAMES.shell).then((c) => c.addAll(PRECACHE)));
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const stale = staleCacheKeys(await caches.keys(), NAMES);
        await Promise.all(stale.map((key) => caches.delete(key)));
        // Start navigation requests in parallel with worker boot.
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const route = routeFor(new URL(req.url), req.mode, self.location.origin);
    if (route === "navigate") event.respondWith(navigate(event, NAMES));
    else if (route === "static") event.respondWith(cacheFirst(event, NAMES));
    else if (route === "asset") event.respondWith(staleWhileRevalidate(event, NAMES));
    // bypass: no respondWith, the browser handles it.
  });
}

// Node (jest) only: expose the helpers for unit tests. In the browser this is a
// classic worker script, where `module` doesn't exist.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCHEMA,
    NAV_TIMEOUT_MS,
    MAX_PAGES,
    OFFLINE_URL,
    versionFrom,
    cacheNames,
    staleCacheKeys,
    routeFor,
    cacheable,
    trim,
    navigate,
    cacheFirst,
    staleWhileRevalidate,
  };
}
