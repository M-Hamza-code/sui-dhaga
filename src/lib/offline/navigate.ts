// Phase 11 (§10 Navigation Safety) — shared by every local-first
// creation/edit form (customer create/edit, order create, measurement
// save) that navigates to the customer's profile right after a
// successful LOCAL save.
//
// Why this exists: a Next.js App Router "soft" navigation
// (`router.push`) for a Server Component route still needs to fetch
// that route's rendered payload from the server. If the browser is
// offline at that exact moment (a real, expected case here — this is
// precisely when a local-first save matters most), that fetch fails,
// and how Next.js's own client-side router recovers from that failure
// is internal, not something this app controls or has verified. A real
// browser navigation instead reliably engages the EXISTING Service
// Worker's own offline-navigation fallback (Phase 8: network fails ->
// serve the cached, on-brand "/offline" page, which already reassures
// the user their data is saved and reuses the same sync-status
// indicator) — a calm, tested landing instead of an unpredictable
// routing failure right after the user's data was just safely written
// to Dexie.
//
// Not a new architecture: this is a two-line wrapper around the
// browser's own `window.location` and the existing isBrowserOnline()
// check (Phase 4) — online behavior is completely unchanged
// (router.push, exactly as every phase since 5 already does).
import { isBrowserOnline } from "./online-status";

/** Minimal shape needed from Next's router — avoids importing the full AppRouterInstance type just for this. */
export interface PushableRouter {
  push: (url: string) => void;
}

export function navigateAfterLocalSave(router: PushableRouter, url: string): void {
  if (isBrowserOnline()) {
    router.push(url);
    return;
  }
  // A real navigation — request.mode "navigate" — which the Service
  // Worker's existing fetch handler already knows how to fail over
  // safely (Phase 8), unlike a client-side RSC fetch.
  window.location.href = url;
}
