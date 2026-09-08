// Phase 7 — human-readable sync status derived from the EXISTING Phase 2
// syncQueue + the EXISTING per-record `syncStatus` field (Phase 2's
// LocalCustomer/LocalMeasurement/LocalOrder all already have one). This
// file adds no new table, no new Dexie version, no new queue, and no
// new sync/retry logic — it only ever READS what Phase 4/5/6 already
// write, then labels it in plain English.
//
// Deliberately split into two halves:
//   - Pure functions (computeGlobalSyncState, syncStateLabel,
//     humanQueueSummary, computeRecordBadge) — take plain data in,
//     return a label out. No Dexie, no "use client", no browser API.
//     These are the part a Node test script can actually exercise
//     without a browser — see test-phase7.mjs.
//   - Dexie-reading wrappers (readSyncStatusSummary,
//     readCustomerSyncBadge, readMeasurementSyncBadge,
//     readOrderSyncBadge) — browser-only, call the pure functions above
//     after gathering raw counts. These can only be verified manually,
//     in a real browser, via /dev/sync-check (Phase 2's own established
//     limitation — no headless browser tool exists in this environment).
import { getOfflineDb, isOfflineDbAvailable } from "./db";
import type { SyncQueueItem } from "./types";

// ── Global (header) indicator ───────────────────────────────────────────

export type SyncState = "synced" | "syncing" | "pending" | "failed" | "conflict";

export interface QueueCounts {
  pendingCount: number;
  sendingCount: number;
  failedCount: number;
  conflictCount: number;
}

export interface SyncStatusSummary extends QueueCounts {
  state: SyncState;
}

/**
 * Priority order when more than one condition holds at once: a conflict
 * needing a human decision outranks a plain failure, which outranks
 * "still working on it", which outranks "queued but idle". This is the
 * only new "business rule" in this phase — everything it reads about
 * (queue item status, record syncStatus) already existed.
 */
export function computeGlobalSyncState(counts: QueueCounts): SyncState {
  if (counts.conflictCount > 0) return "conflict";
  if (counts.failedCount > 0) return "failed";
  if (counts.sendingCount > 0) return "syncing";
  if (counts.pendingCount > 0) return "pending";
  return "synced";
}

export function syncStateLabel(state: SyncState): string {
  switch (state) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing…";
    case "pending":
      return "Pending changes";
    case "failed":
      return "Sync failed";
    case "conflict":
      return "Conflict needs attention";
  }
}

/** One plain-English sentence for the expanded panel — never raw counts/ids/payloads (Phase 7 §B). */
export function humanQueueSummary(summary: QueueCounts): string {
  const parts: string[] = [];
  if (summary.pendingCount > 0) parts.push(`${summary.pendingCount} waiting to sync`);
  if (summary.sendingCount > 0) parts.push(`${summary.sendingCount} syncing now`);
  if (summary.failedCount > 0) parts.push(`${summary.failedCount} failed`);
  if (summary.conflictCount > 0) parts.push(`${summary.conflictCount} need${summary.conflictCount === 1 ? "s" : ""} attention`);
  return parts.length > 0 ? `${parts.join(", ")}.` : "All changes are saved to the server.";
}

/** Reads the real counts from the existing syncQueue + the three existing local tables' syncStatus field — no new table, no new index beyond what Phase 2 already declared. */
export async function readSyncStatusSummary(): Promise<SyncStatusSummary | null> {
  if (!isOfflineDbAvailable()) return null;
  const db = getOfflineDb();
  await db.open();

  const [pendingCount, sendingCount, failedCount, conflictCustomers, conflictMeasurements, conflictOrders] = await Promise.all([
    db.syncQueue.where("status").equals("pending").count(),
    db.syncQueue.where("status").equals("sending").count(),
    db.syncQueue.where("status").equals("failed").count(),
    db.customers.where("syncStatus").equals("conflict").count(),
    db.measurements.where("syncStatus").equals("conflict").count(),
    db.orders.where("syncStatus").equals("conflict").count(),
  ]);

  const counts: QueueCounts = {
    pendingCount,
    sendingCount,
    failedCount,
    conflictCount: conflictCustomers + conflictMeasurements + conflictOrders,
  };

  return { ...counts, state: computeGlobalSyncState(counts) };
}

// ── "Sync now" outcome (Part G) ──────────────────────────────────────────

export interface SyncNowOutcome {
  /** Plain-English message for the panel — never raw counts/ids. */
  message: string;
  /** False only when we deliberately did not call processSyncQueue() at all (offline) — Phase 7 §G: never claim success in that case. */
  attempted: boolean;
}

/**
 * Pure decision logic for the "Sync now" button's result message, kept
 * separate from processSyncQueue() itself (Phase 4, unchanged) so this
 * one small piece — "what do we tell the user afterward" — is testable
 * without a browser. Takes the SAME `online` check and the SAME
 * ProcessResult shape processSyncQueue() already returns; never calls
 * fetch(), never touches the queue, never duplicates retry/backoff
 * logic.
 */
export function computeSyncNowOutcome(input: {
  online: boolean;
  result: { authRequired: boolean; syncedCount: number; processedCount: number } | null;
}): SyncNowOutcome {
  if (!input.online) {
    // Phase 10 (§2/§5) — explicitly names "saved on this device" rather
    // than only promising a future sync, so this can never read as if
    // nothing happened: the save already succeeded, only delivery to
    // the server is waiting on a connection.
    return { message: "You're offline — your changes are saved on this device and will sync once you're back online.", attempted: false };
  }
  const result = input.result;
  if (!result) {
    return { message: "Nothing to sync right now.", attempted: true };
  }
  if (result.authRequired) {
    return { message: "Please log in again to sync your changes.", attempted: true };
  }
  if (result.syncedCount > 0) {
    return { message: `Synced ${result.syncedCount} change${result.syncedCount === 1 ? "" : "s"}.`, attempted: true };
  }
  if (result.processedCount > 0) {
    return { message: "Still working on it — check again shortly.", attempted: true };
  }
  return { message: "Nothing to sync right now.", attempted: true };
}

// ── Per-record badge (Customer / Measurement / Order) ───────────────────

/**
 * Same four states as the global indicator, applied to one record.
 * "failed" specifically means: the record's own local syncStatus is
 * still "pending" (Phase 2's 3-value SyncStatus type has no "failed"
 * value, deliberately not extended here — see the Phase 7 report), but
 * a matching queue item has exhausted retries or been rejected — i.e.
 * `hasFailedQueueItem` is the one new distinguishing fact this phase
 * introduces, and it comes from reading the EXISTING syncQueue, not a
 * new field.
 */
export function computeRecordBadge(input: {
  localSyncStatus: "synced" | "pending" | "conflict" | null;
  hasFailedQueueItem: boolean;
}): SyncState | null {
  if (input.localSyncStatus === null) return null; // no local mirror row — nothing to report
  if (input.localSyncStatus === "conflict") return "conflict";
  if (input.localSyncStatus === "synced") return "synced";
  // "pending" locally — distinguish "still queued" from "permanently failed".
  return input.hasFailedQueueItem ? "failed" : "pending";
}

async function hasFailedQueueItemMatching(matches: (item: SyncQueueItem) => boolean): Promise<boolean> {
  const db = getOfflineDb();
  const count = await db.syncQueue.where("status").equals("failed").filter(matches).count();
  return count > 0;
}

export async function readCustomerSyncBadge(customerId: string): Promise<SyncState | null> {
  if (!isOfflineDbAvailable()) return null;
  const db = getOfflineDb();
  await db.open();
  const local = await db.customers.get(customerId);
  if (!local) return null;
  const hasFailedQueueItem =
    local.syncStatus === "pending"
      ? await hasFailedQueueItemMatching(
          (item) =>
            (item.op === "CREATE_CUSTOMER" && (item.payload as { id: string }).id === customerId) ||
            (item.op === "UPDATE_CUSTOMER" && (item.payload as { customerId: string }).customerId === customerId)
        )
      : false;
  return computeRecordBadge({ localSyncStatus: local.syncStatus, hasFailedQueueItem });
}

export async function readMeasurementSyncBadge(customerId: string): Promise<SyncState | null> {
  if (!isOfflineDbAvailable()) return null;
  const db = getOfflineDb();
  await db.open();
  const local = await db.measurements.where("customerId").equals(customerId).first();
  if (!local) return null;
  const hasFailedQueueItem =
    local.syncStatus === "pending"
      ? await hasFailedQueueItemMatching((item) => item.op === "SAVE_MEASUREMENT" && (item.payload as { customerId: string }).customerId === customerId)
      : false;
  return computeRecordBadge({ localSyncStatus: local.syncStatus, hasFailedQueueItem });
}

export async function readOrderSyncBadge(orderId: string): Promise<SyncState | null> {
  if (!isOfflineDbAvailable()) return null;
  const db = getOfflineDb();
  await db.open();
  const local = await db.orders.get(orderId);
  if (!local) return null;
  const hasFailedQueueItem =
    local.syncStatus === "pending"
      ? await hasFailedQueueItemMatching((item) => item.op === "CREATE_ORDER" && (item.payload as { id: string }).id === orderId)
      : false;
  return computeRecordBadge({ localSyncStatus: local.syncStatus, hasFailedQueueItem });
}
