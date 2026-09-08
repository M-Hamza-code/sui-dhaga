"use client";

// Phase 7 (Part A/B/G) — small, non-intrusive sync status indicator for
// the shared PageHeader (the ONE header component every authenticated
// page already renders — see that file's own Step 45 comment). Mounted
// next to SettingsMenu, same popover interaction pattern (click to
// open, click-outside/Escape to close) that component already
// established — no new UI pattern introduced.
//
// This is a READ-ONLY view over Phase 2's existing syncQueue + the
// existing per-record syncStatus fields (via sync-status.ts's pure
// summary logic) plus the existing connectivity util (online-status.ts,
// Phase 4). It polls those on a plain interval — deliberately NOT a new
// sync/polling SYSTEM: it never writes to the queue, never calls
// fetch(), and never drains anything itself. The only write path here
// is "Sync now", which calls the EXISTING processSyncQueue() (Phase 4)
// directly — no second implementation of retry/backoff/delivery logic.
import { useEffect, useRef, useState } from "react";
import {
  readSyncStatusSummary,
  syncStateLabel,
  humanQueueSummary,
  computeSyncNowOutcome,
  type SyncState,
  type SyncStatusSummary,
} from "@/lib/offline/sync-status";
import { processSyncQueue, retryFailedQueueItems } from "@/lib/offline/sync-engine";
import { isBrowserOnline, subscribeToConnectivity } from "@/lib/offline/online-status";
import { isOfflineDbAvailable } from "@/lib/offline/db";

// A plain UI refresh cadence, not a sync attempt — matches "keep the UI
// simple" (Phase 7 goal); processSyncQueue() itself is only ever called
// on mount/reconnect (SyncQueueBootstrap, unchanged) or by "Sync now".
const POLL_MS = 3000;

const TONE: Record<SyncState, string> = {
  synced: "border-rule text-graphite/60",
  syncing: "border-indigo text-indigo",
  pending: "border-amber text-amber",
  failed: "border-red-300 text-red-700",
  conflict: "border-red-300 text-red-700",
};

const DOT_TONE: Record<SyncState, string> = {
  synced: "bg-graphite/30",
  syncing: "bg-indigo animate-pulse",
  pending: "bg-amber",
  failed: "bg-red-600",
  conflict: "bg-red-600",
};

export function SyncStatusIndicator() {
  const [summary, setSummary] = useState<SyncStatusSummary | null>(null);
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const result = await readSyncStatusSummary();
    setSummary(result);
  }

  useEffect(() => {
    if (!isOfflineDbAvailable()) return; // SSR / no IndexedDB — render nothing (see below)
    setOnline(isBrowserOnline());
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    const unsubscribe = subscribeToConnectivity({
      onOnline: () => {
        setOnline(true);
        refresh();
      },
      onOffline: () => setOnline(false),
    });
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSyncNow() {
    setManualMessage(null);

    // Phase 7 §G — never claim success while offline. navigator.onLine
    // is only a best-effort pre-check (see online-status.ts's own
    // comment), but it's enough to avoid the misleading "Syncing…" ->
    // immediately-nothing-happened flash when we already know we're
    // disconnected; processSyncQueue()'s own fetch() failures are still
    // the real safety net for the "looked online but wasn't" case. The
    // actual online/offline -> message decision is computeSyncNowOutcome()
    // (sync-status.ts) — a pure function, tested directly without a
    // browser in test-phase7.mjs — not decided inline here.
    const online = isBrowserOnline();
    if (!online) {
      setManualMessage(computeSyncNowOutcome({ online: false, result: null }).message);
      return;
    }

    setManualSyncing(true);
    const result = await processSyncQueue();
    await refresh();
    setManualSyncing(false);

    setManualMessage(computeSyncNowOutcome({ online: true, result }).message);
  }

  // Phase 9 (§5) — "Retry failed": moves every "failed" queue item back
  // to "pending" (retryFailedQueueItems — reuses the exact same queue
  // items, same ids, same idempotencyKeys, never creates new ones) and
  // then processes the queue exactly like "Sync now" does — no second
  // sync implementation. Same offline guard as "Sync now": never claims
  // success while offline.
  async function handleRetryFailed() {
    setManualMessage(null);

    if (!isBrowserOnline()) {
      setManualMessage(computeSyncNowOutcome({ online: false, result: null }).message);
      return;
    }

    setManualSyncing(true);
    const { retriedCount } = await retryFailedQueueItems();
    const result = retriedCount > 0 ? await processSyncQueue() : null;
    await refresh();
    setManualSyncing(false);

    if (retriedCount === 0) {
      setManualMessage("Nothing to retry right now.");
      return;
    }
    setManualMessage(computeSyncNowOutcome({ online: true, result }).message);
  }

  // Not available (SSR) or genuinely nothing to report yet on first
  // mount — render nothing rather than a placeholder that could imply a
  // state that hasn't actually been read.
  if (!summary) return null;

  const state = summary.state;
  const label = manualSyncing ? "Syncing…" : syncStateLabel(state);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sync status: ${label}`}
        className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium transition ${TONE[manualSyncing ? "syncing" : state]}`}
      >
        <span className={`h-2 w-2 flex-none rounded-full ${DOT_TONE[manualSyncing ? "syncing" : state]}`} aria-hidden="true" />
        {label}
        {!online && <span className="text-graphite/40">· Offline</span>}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Sync status details"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-sm border border-rule bg-card p-3 text-sm text-graphite shadow-sm"
        >
          {/* Phase 10 (§2/§5) — shown whenever the browser itself is
              offline, regardless of queue state: the most important
              reassurance in the whole app, so it comes first, plainly,
              every time. Never implies anything failed — being offline
              is not the same as sync failing (see humanQueueSummary/
              computeGlobalSyncState below, which never conflate the
              two: the state shown is always driven by the actual queue
              counts, never by the online/offline flag itself). */}
          {!online && (
            <p className="text-graphite">
              Offline — changes are saved on this device and will sync when your connection returns.
            </p>
          )}

          <p className={online ? undefined : "mt-2"}>{humanQueueSummary(summary)}</p>

          {summary.conflictCount > 0 && (
            <p className="mt-2 text-red-700">This information was changed somewhere else and needs attention before it can sync.</p>
          )}
          {summary.failedCount > 0 && (
            <p className="mt-2 text-red-700">
              Some changes could not reach the server yet. They&apos;re saved safely on this device — nothing was lost.
            </p>
          )}

          {manualMessage && <p className="mt-2 text-graphite/70">{manualMessage}</p>}

          <button
            type="button"
            onClick={handleSyncNow}
            disabled={manualSyncing}
            className="mt-3 w-full rounded-sm bg-indigo px-3 py-1.5 text-white transition hover:bg-indigo-hover disabled:opacity-60"
          >
            {manualSyncing ? "Syncing…" : "Sync now"}
          </button>

          {/* Phase 9 (§5) — only offered when there's something to
              retry; a permanently-failed item is never silently dropped,
              this is simply how the user asks for another attempt. */}
          {summary.failedCount > 0 && (
            <button
              type="button"
              onClick={handleRetryFailed}
              disabled={manualSyncing}
              className="mt-2 w-full rounded-sm border border-red-300 px-3 py-1.5 text-red-700 transition hover:bg-red-50 disabled:opacity-60"
            >
              {manualSyncing ? "Working…" : "Retry failed"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
