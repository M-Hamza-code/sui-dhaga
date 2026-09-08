// Phase 4 — small, framework-independent online-detection utility.
//
// Deliberately not a React hook or a global state-management system —
// just two plain functions the sync engine (and later, a UI status
// indicator in a future phase) can call directly. No new dependency.
//
// `navigator.onLine` is used only as a cheap pre-check, never as proof
// the server is actually reachable (a captive portal, DNS issue, or a
// server outage can all leave navigator.onLine === true while every
// real request still fails) — the sync engine's own try/catch around
// each fetch() call is the actual safety net; see sync-engine.ts.

/** Best-effort only — see the file header for why this is never treated as proof of reachability. */
export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/**
 * Subscribes to the browser's `online`/`offline` events and calls
 * `onOnline`/`onOffline` when they fire. Returns an unsubscribe
 * function. Safe to call in a non-browser environment (a no-op there).
 */
export function subscribeToConnectivity(handlers: { onOnline?: () => void; onOffline?: () => void }): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onOnline = () => handlers.onOnline?.();
  const onOffline = () => handlers.onOffline?.();

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
