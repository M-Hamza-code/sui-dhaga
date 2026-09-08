"use client";

// Phase 4 — mounts the sync queue processor's "attempt any pending work"
// triggers once per app load. Mirrors GlobalShortcuts' and
// InitialSyncBootstrap's own mounting pattern exactly (a single,
// non-visual client component, mounted once in the root layout).
//
// Kept as its own file rather than folded into InitialSyncBootstrap —
// each of the three root-mounted components has one clear job
// (keyboard shortcuts / initial data pull / queue draining), matching
// this project's established one-small-file-per-concern style.
//
// What this does, in order, on mount:
//   1. Calls processSyncQueue() once — this recovers any item left
//      "sending" from a previous session (browser refresh/close/crash)
//      back to "pending" and attempts to drain whatever's queued, which
//      covers the "reconnected after being closed while offline" case.
//   2. Subscribes to the browser's `online` event so that if the
//      connection comes back while the app is already open, the same
//      draining logic runs again automatically (Phase 4 §11).
//   3. (Phase 9 §7) Runs the read-only local/queue consistency check
//      ONCE and console.warns if it finds anything — no new startup
//      processor, no polling: this is the SAME existing mount effect,
//      just also looking for obviously-broken states while it's here.
//      Never deletes or "fixes" anything; see consistency-check.ts.
//
// Renders nothing; never throws — processSyncQueue() itself resolves
// every failure mode instead of rejecting (see its own comment), and
// the consistency check below is wrapped the same way.
import { useEffect } from "react";
import { processSyncQueue } from "@/lib/offline/sync-engine";
import { subscribeToConnectivity } from "@/lib/offline/online-status";
import { readConsistencyIssues } from "@/lib/offline/consistency-check";

export function SyncQueueBootstrap() {
  useEffect(() => {
    processSyncQueue().catch((err) => {
      console.error("[offline] unexpected error from processSyncQueue()", err);
    });

    readConsistencyIssues()
      .then((issues) => {
        if (issues.length > 0) {
          console.warn(`[offline] local/queue consistency check found ${issues.length} issue(s):`, issues);
        }
      })
      .catch((err) => {
        console.error("[offline] unexpected error from readConsistencyIssues()", err);
      });

    const unsubscribe = subscribeToConnectivity({
      onOnline: () => {
        processSyncQueue().catch((err) => {
          console.error("[offline] unexpected error from processSyncQueue() on reconnect", err);
        });
      },
    });

    return unsubscribe;
  }, []);

  return null;
}
