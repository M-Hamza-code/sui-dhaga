// Phase 3 — client-side half of the initial Server → Local sync.
//
// Plain module, not a component — no "use client" needed (matches
// ./db.ts's own pattern). Imports nothing server-only; the only network
// call is a plain `fetch("/api/sync/initial")`, and the only database
// access is through the existing Phase 2 getOfflineDb()/isOfflineDbAvailable().
//
// This is intentionally the ONLY thing this module does: ask the new
// read-only endpoint for the current dataset, and write it into Dexie.
// No sync queue, no offline mutation, no retry/backoff engine — those
// are explicitly out of scope for this phase.
import type { Table } from "dexie";
import { getOfflineDb, isOfflineDbAvailable } from "./db";
import type {
  LocalCustomer,
  LocalMeasurement,
  LocalMeasurementSnapshot,
  LocalOrder,
  LocalOrderItem,
  LocalDesignOption,
  LocalShopSettings,
  SyncQueueItem,
  SyncStatus,
} from "./types";

export type InitialSyncResult =
  | { status: "skipped"; reason: "no-indexeddb" | "offline" }
  | { status: "unauthorized" }
  | { status: "error"; message: string }
  | { status: "success"; counts: Record<string, number>; pulledAt: string };

/** Shape returned by GET /api/sync/initial — see that route for the authoritative definition. */
interface InitialSyncResponse {
  pulledAt: string;
  customers: Omit<LocalCustomer, "syncStatus">[];
  measurements: Omit<LocalMeasurement, "syncStatus">[];
  orders: Omit<LocalOrder, "syncStatus">[];
  orderItems: Omit<LocalOrderItem, "syncStatus">[];
  measurementSnapshots: Omit<LocalMeasurementSnapshot, "syncStatus">[];
  designOptions: LocalDesignOption[];
  shopSettings: Omit<LocalShopSettings, never> | null;
}

/**
 * Phase 9 hardening — the one decision this file's local-edit-
 * preserving bulk-write makes: given what a local row's own syncStatus
 * currently is (or `undefined` if there isn't one yet), should the
 * server's snapshot of that same record be written over it?
 *
 * Extracted as a plain, pure function (no Dexie/Table involved) purely
 * so this one rule is directly testable without a browser — see
 * test-phase9.mjs. `bulkPutPreservingPendingEdits` below is the only
 * caller.
 */
export function shouldSkipServerRow(existingLocalSyncStatus: SyncStatus | undefined): boolean {
  return existingLocalSyncStatus !== undefined && existingLocalSyncStatus !== "synced";
}

/**
 * Step 55 (Part 6) — the order-deletion analogue of shouldSkipServerRow
 * above: which order ids this browser has already locally deleted (via
 * enqueueDeleteOrder) but whose DELETE_ORDER queue item hasn't reached
 * "synced" yet. Without this, calling runInitialSync() again — which
 * happens on every app load/refresh, same as the Phase 9 problem this
 * mirrors — would pull the still-existing server row right back into
 * Dexie, resurrecting an order the admin just deleted on this device
 * before the delete itself had a chance to reach the server. A "failed"
 * DELETE_ORDER item is included too (not just "pending"/"sending"): if
 * the delete didn't apply for some real reason, the order should stay
 * visibly gone locally with the failure surfaced (same as any other
 * failed queue item), never silently un-deleted out from under the
 * admin.
 *
 * Extracted as a plain, pure function — no Dexie/Table involved — for
 * the same reason shouldSkipServerRow is: directly testable without a
 * browser.
 */
export function pendingDeleteOrderIds(queueItems: Pick<SyncQueueItem, "op" | "status" | "payload">[]): Set<string> {
  const ids = new Set<string>();
  for (const item of queueItems) {
    if (item.op !== "DELETE_ORDER" || item.status === "synced") continue;
    const payload = item.payload as { orderId?: unknown } | undefined;
    if (payload && typeof payload.orderId === "string") {
      ids.add(payload.orderId);
    }
  }
  return ids;
}

/**
 * Phase 9 hardening — writes `serverRows` into `table`, but SKIPS any
 * row whose LOCAL copy currently has a non-"synced" syncStatus (i.e. a
 * "pending" edit not yet delivered, or a "conflict" awaiting review) —
 * see shouldSkipServerRow() above for the actual rule.
 *
 * Without this guard, calling runInitialSync() again (which
 * SyncQueueBootstrap/InitialSyncBootstrap already do on every app
 * load — a plain browser refresh included) would blindly overwrite a
 * customer/measurement/order's local row with the server's own,
 * necessarily STALE snapshot (the local edit hasn't reached the server
 * yet — that's exactly what "pending" means), and mark it
 * `syncStatus: "synced"` even though a real edit is still sitting in
 * the queue. The queued sync item itself was never at risk (this
 * function never touches syncQueue), but the LOCAL RECORD's displayed
 * values and badge would have silently reverted, which is precisely
 * the "silently discard local changes" / "pending items survive
 * browser refresh" failure this phase exists to close.
 *
 * orderItems/measurementSnapshots/designOptions/shopSettings are NOT
 * routed through this — per the established Phase 1/6 rule, none of
 * those are ever independently created/edited offline (order items and
 * snapshots only ever arrive nested inside a CREATE_ORDER queue item,
 * never as their own local table write), so there is no local-pending
 * state on those tables to protect and the original unconditional
 * bulkPut for them is unchanged.
 */
async function bulkPutPreservingPendingEdits<T extends { id: string; syncStatus: SyncStatus }>(
  table: Table<T, string>,
  serverRows: Omit<T, "syncStatus">[],
  /** Step 55 — ids to skip outright regardless of local syncStatus (a pending local DELETE_ORDER — see pendingDeleteOrderIds above). Only the `orders` table passes this; every other table keeps the original two-argument behavior. */
  skipIds?: Set<string>
): Promise<void> {
  if (serverRows.length === 0) return;

  const ids = serverRows.map((row) => (row as unknown as { id: string }).id);
  const existingRows = await table.bulkGet(ids);

  const rowsToWrite: T[] = [];
  for (let i = 0; i < serverRows.length; i++) {
    if (skipIds?.has(ids[i])) {
      continue;
    }
    if (shouldSkipServerRow(existingRows[i]?.syncStatus)) {
      continue;
    }
    rowsToWrite.push({ ...serverRows[i], syncStatus: "synced" } as T);
  }

  if (rowsToWrite.length > 0) {
    await table.bulkPut(rowsToWrite);
  }
}

/**
 * Pulls the full current dataset from the server and writes it into the
 * local Dexie database, then records the successful pull time in
 * syncMeta. Every server-originated row is written with
 * `syncStatus: "synced"` — this endpoint never returns anything that
 * isn't already durably saved server-side.
 *
 * Never throws. Every failure mode (no IndexedDB, offline, network
 * error, non-200 response, malformed JSON) resolves to a distinct,
 * inspectable result instead — this must never be able to break the
 * page that called it, and a failed sync must never touch, clear, or
 * corrupt whatever was already in the local database.
 */
export async function runInitialSync(): Promise<InitialSyncResult> {
  if (!isOfflineDbAvailable()) {
    return { status: "skipped", reason: "no-indexeddb" };
  }

  // A cheap pre-check only, not proof of reachability — navigator.onLine
  // can be true while the server is actually unreachable (captive portal,
  // DNS issue, etc.). The real safety net is the try/catch around fetch()
  // below; this just avoids an obviously-futile attempt when the browser
  // itself already knows it has no connection at all.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { status: "skipped", reason: "offline" };
  }

  let response: Response;
  try {
    response = await fetch("/api/sync/initial", { method: "GET", cache: "no-store" });
  } catch (err) {
    // Network failure (offline, DNS, server unreachable, etc.) — the
    // existing online application must keep working normally regardless;
    // this is exactly the "log/handle safely, never crash" case.
    console.error("[offline] initial sync: network request failed", err);
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }

  if (response.status === 401) {
    // Not authenticated (or session expired) — expected and harmless on
    // an unauthenticated page load; nothing to sync, nothing to report
    // as an error.
    return { status: "unauthorized" };
  }

  if (!response.ok) {
    console.error(`[offline] initial sync: server responded ${response.status}`);
    return { status: "error", message: `Server responded ${response.status}` };
  }

  let data: InitialSyncResponse;
  try {
    data = await response.json();
  } catch (err) {
    console.error("[offline] initial sync: response was not valid JSON", err);
    return { status: "error", message: "Malformed sync response" };
  }

  const db = getOfflineDb();

  try {
    // One atomic transaction across every affected table: if any single
    // write throws, Dexie rolls back the whole transaction, so the local
    // database can never end up with some tables updated and others not
    // — the "must not leave the local database partially updated"
    // requirement is satisfied by construction, not by manual bookkeeping.
    await db.transaction(
      "rw",
      [db.customers, db.measurements, db.orders, db.orderItems, db.measurementSnapshots, db.designOptions, db.shopSettings, db.syncQueue, db.syncMeta],
      async () => {
        // Step 55 (Part 6) — orders this browser has already locally
        // deleted but whose delete hasn't reached "synced" yet must
        // never be pulled back in by this same sync run — see
        // pendingDeleteOrderIds's own comment.
        const pendingDeletes = pendingDeleteOrderIds(await db.syncQueue.toArray());

        // Phase 9 — these three tables can each have a locally-pending
        // (not yet synced) or conflicted edit in flight, so they go
        // through the guard above rather than a blind bulkPut. See that
        // function's own comment for exactly why.
        await bulkPutPreservingPendingEdits<LocalCustomer>(db.customers, data.customers);
        await bulkPutPreservingPendingEdits<LocalMeasurement>(db.measurements, data.measurements);
        await bulkPutPreservingPendingEdits<LocalOrder>(db.orders, data.orders, pendingDeletes);
        // orderItems is never independently locally-edited (Phase 1/6) —
        // unchanged, plain bulkPut, except the same pending-delete
        // filter above: an item belonging to a locally-deleted-but-not-
        // yet-synced order must not be resurrected either.
        await db.orderItems.bulkPut(
          data.orderItems.filter((i) => !pendingDeletes.has(i.orderId)).map((i): LocalOrderItem => ({ ...i, syncStatus: "synced" }))
        );
        await db.measurementSnapshots.bulkPut(
          data.measurementSnapshots.map((s): LocalMeasurementSnapshot => ({ ...s, syncStatus: "synced" }))
        );
        await db.designOptions.bulkPut(data.designOptions);
        if (data.shopSettings) {
          await db.shopSettings.put(data.shopSettings as LocalShopSettings);
        }

        // Written last, inside the same transaction, so it only commits
        // — and therefore only reflects "successful" — alongside every
        // other write above. If anything above throws, this line never
        // takes effect either, exactly matching "syncMeta updates only
        // after successful synchronization".
        await db.syncMeta.put({ key: "lastPulledAt", value: data.pulledAt });
      }
    );
  } catch (err) {
    // Whatever was in Dexie before this call started is untouched — a
    // Dexie transaction failure rolls back every write attempted inside
    // it; nothing here explicitly deletes anything, so there is no
    // separate "undo" step required.
    console.error("[offline] initial sync: local write failed, local data left as it was", err);
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }

  return {
    status: "success",
    pulledAt: data.pulledAt,
    counts: {
      customers: data.customers.length,
      measurements: data.measurements.length,
      orders: data.orders.length,
      orderItems: data.orderItems.length,
      measurementSnapshots: data.measurementSnapshots.length,
      designOptions: data.designOptions.length,
      shopSettings: data.shopSettings ? 1 : 0,
    },
  };
}
