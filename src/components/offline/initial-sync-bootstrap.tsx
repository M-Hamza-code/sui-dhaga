"use client";

// Phase 3 — mounts the initial Server → Local sync once per app load.
//
// Deliberately mirrors GlobalShortcuts' own mounting pattern exactly
// (see src/components/global-shortcuts.tsx and its root-layout mount):
// a single, non-visual client component, mounted once in the root
// layout, running one `useEffect` with an empty dependency array. Next's
// App Router layouts persist across client-side navigation
// (only `children` swaps between routes), so this effect fires exactly
// once per full page load/refresh — not once per page navigated to —
// which is the right frequency for a one-shot initial sync.
//
// This mounts on every route the root layout wraps, /login included.
// That is intentional, not an oversight: runInitialSync() itself calls
// the new endpoint, which independently requires a valid session
// (getSession()) and returns a plain, harmless "unauthorized" result if
// there isn't one — exactly like every existing Server Action already
// re-checks its own auth rather than trusting the page around it. No
// page-level "is this an authenticated route" check was added here, to
// avoid introducing a second, parallel notion of "which routes require
// login" alongside middleware.ts's own PROTECTED_PREFIXES list.
//
// Renders nothing; never throws (runInitialSync() itself resolves every
// failure mode instead of rejecting) — see that function's own comment.
import { useEffect } from "react";
import { runInitialSync } from "@/lib/offline/initial-sync";

export function InitialSyncBootstrap() {
  useEffect(() => {
    runInitialSync().catch((err) => {
      // Defensive only — runInitialSync() is designed to never reject,
      // but this still must never surface as an unhandled rejection or
      // break the page if that guarantee is ever violated by a future
      // change.
      console.error("[offline] unexpected error from runInitialSync()", err);
    });
  }, []);

  return null;
}
