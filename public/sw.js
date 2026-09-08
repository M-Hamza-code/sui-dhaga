// Phase 8 — Service Worker (Part C/D/E/F/G/H/I).
//
// This file is responsible ONLY for application-shell/static-resource
// availability. It is a plain, hand-written Service Worker — no
// Workbox/next-pwa or other build plugin — chosen deliberately so the
// caching rules below are fully explicit and auditable rather than a
// library's defaults (which commonly cache page HTML more aggressively
// than is safe for an authenticated, per-user admin app like this one).
//
// It does NOT, and must never:
//   - import/require Dexie, touch IndexedDB, read/write syncQueue, or
//     call/duplicate processSyncQueue() — all of that is, and remains,
//     the existing application JavaScript's job (src/lib/offline/*).
//     This file contains no business logic at all.
//   - cache any Server Action, any /api/* response, or any navigated
//     PAGE's HTML. Those are per-user, dynamic, and often
//     authentication-gated — caching them here would risk exactly what
//     Phase 8's own brief warns against (stale or cross-user data).
//   - talk to Prisma/PostgreSQL, or know anything about customers,
//     orders, or measurements.
//
// What it DOES cache: the static application shell only — JS/CSS/font
// chunks under Next's own /_next/static/ (content-hashed and therefore
// immutable per build — safe to cache-first forever), the manifest, the
// two icon files, and one small, non-authenticated offline fallback
// page (/offline). Navigations always go to the network first; the
// fallback is only ever shown when that fetch genuinely fails (no
// connection), never as a substitute for a real, fresh, authenticated
// page.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `sui-dhaga-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

// Precached once, on install, while the browser still has a real
// connection (Phase 8's own "first visit while online" requirement).
// Deliberately a short, explicit list — not "cache everything" (Part D:
// "Do not blindly cache everything").
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // Takes over as soon as it's ready rather than waiting for every
      // open tab to close first (Part I) — safe here because nothing
      // this Service Worker caches ever goes stale in a way that could
      // break a page: static chunks are content-hashed (a new build's
      // HTML references new hashes, never reusing an old, different-
      // content URL under the same name), and no page HTML is ever
      // served from cache except the fixed, non-authenticated /offline
      // fallback.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Cache cleanup (Part I): deletes any cache left over from a
    // previous version of this Service Worker. Never touches anything
    // else this origin might store — IndexedDB (Dexie's own database)
    // is a completely separate browser storage mechanism from Cache
    // Storage and is never read, written, or cleared by this file.
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  // Next.js's own build output — JS/CSS/font chunks, all content-hashed
  // by filename, so a cache-first strategy can never serve stale
  // content for a given URL (a new build simply requests different
  // URLs). Deliberately excludes /_next/image (an on-the-fly
  // transformation endpoint whose output can vary by request) and
  // everything else server-rendered.
  if (url.pathname.startsWith("/_next/static/")) return true;
  return /\.(?:woff2?|ttf|otf|png|jpg|jpeg|gif|svg|ico|webmanifest)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only ever handle same-origin GET requests. Every POST (Server
  // Actions, the existing /api/sync/* endpoints the sync engine already
  // calls) and every cross-origin request passes straight through,
  // completely unaffected by this Service Worker's existence — the
  // browser's normal network behavior applies exactly as if no Service
  // Worker were registered at all.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Never intercept the existing sync API — the sync engine's own
  // fetch() calls (processSyncQueue, the initial-sync pull, etc.) must
  // always reach the real network/server, never a cached response.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Page navigations: network-first, and ONLY on failure fall back to
  // the fixed, non-authenticated /offline page — the actual navigated
  // response (a real Server Component render, often behind a session
  // cookie) is NEVER written to any cache (Part E/H — this is the one
  // rule this file is built around). A user who's still online always
  // gets the real, fresh, correctly-authenticated page; a user who's
  // offline gets an honest "you're offline" screen instead of a raw
  // browser network-error page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Static shell assets: cache-first, populating the cache the first
  // time each exact URL is actually requested (no build-time precache
  // manifest needed — content-hashed filenames make this safe). This is
  // what makes "previously visited app resources become cached" true
  // without a Workbox-style build plugin.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  // Everything else (RSC data payloads, dynamic fragments, anything
  // else server-rendered) — left completely unhandled, so the browser's
  // default network behavior applies, exactly as if this Service Worker
  // did not exist. Nothing here is ever cached.
});
