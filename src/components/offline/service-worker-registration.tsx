"use client";

// Phase 8 (Part B/C/J) — registers the Service Worker (public/sw.js).
// Mounted once in root layout, same pattern as GlobalShortcuts/
// InitialSyncBootstrap/SyncQueueBootstrap (Phase 2-4): a single,
// non-visual client component. Renders nothing; contains no caching or
// synchronization logic itself — that all lives in sw.js and the
// existing sync-engine.ts, respectively.
//
// Production only (Part J): registering a Service Worker during
// `npm run dev` would let it intercept Next's own dev-mode asset
// requests — which are NOT content-hashed the way a real build's are
// and change on every save — causing exactly the confusing, stale-
// asset development experience this phase's own instructions warn
// against. In development, any Service Worker already controlling this
// origin (e.g. left over from an earlier `npm run build && npm start`
// on the same port) is actively unregistered instead, together with
// its caches, so switching back to `npm run dev` can never get stuck
// behind a stale production Service Worker.
import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations) {
            registration.unregister().catch(() => {});
          }
        })
        .catch(() => {});
      if (typeof caches !== "undefined") {
        caches
          .keys()
          .then((keys) => Promise.all(keys.filter((key) => key.startsWith("sui-dhaga-shell-")).map((key) => caches.delete(key))))
          .catch(() => {});
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[pwa] service worker registration failed", err);
    });
  }, []);

  return null;
}
