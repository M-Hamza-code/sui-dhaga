"use client";

// Phase 6 (offline-first) — a small, additive companion to
// CustomerIdentityCard (Phase 5): checks the local Dexie mirror for any
// order belonging to this customer that isn't in the server-rendered
// Order History table yet (a not-yet-synced order, created offline or
// whose create-sync hasn't reached the server yet — see order-form.tsx's
// handleSubmit) and lists it separately, above that table.
//
// Deliberately does NOT try to merge into the existing <table> (which
// stays a plain server-rendered element, completely untouched — see
// /customers/[customerId]/page.tsx's own comment) — this renders a
// separate, clearly-labeled block instead, the same "local storage is
// the source of truth, shown honestly as pending" principle
// CustomerIdentityCard already established for the identity header.
//
// Phase 7 (Part E) — each listed order now also shows "Sync failed"
// instead of "Pending sync" specifically for the ones whose CREATE_ORDER
// queue item has exhausted retries/been rejected (same distinction
// computeRecordBadge()/readOrderSyncBadge() draw in sync-status.ts).
// Computed here as one batch query rather than N per-order calls to
// that helper, since this component already needs its own list of
// not-yet-synced orders first; the underlying rule (a "pending" local
// syncStatus + a matching "failed" queue item = failed) is the same one.
import { useEffect, useState } from "react";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import type { LocalOrder, SyncQueueItem } from "@/lib/offline/types";
import type { CreateOrderPayload } from "@/lib/offline/sync-engine";
import { formatDate, formatMoney } from "@/lib/format";

interface PendingOrderRow extends LocalOrder {
  failed: boolean;
}

export function PendingOrdersNotice({ customerId, knownOrderIds }: { customerId: string; knownOrderIds: string[] }) {
  const [pending, setPending] = useState<PendingOrderRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function readLocal() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const known = new Set(knownOrderIds);
        const local = await db.orders.where("customerId").equals(customerId).toArray();
        const notYetSynced = local.filter((o) => o.syncStatus !== "synced" && !known.has(o.id));
        if (notYetSynced.length === 0) {
          if (!cancelled) setPending([]);
          return;
        }
        const failedItems = await db.syncQueue.where("status").equals("failed").filter((item: SyncQueueItem) => item.op === "CREATE_ORDER").toArray();
        const failedIds = new Set(failedItems.map((item) => (item.payload as CreateOrderPayload).id));
        const withBadge = notYetSynced.map((o) => ({ ...o, failed: failedIds.has(o.id) }));
        if (!cancelled) setPending(withBadge);
      } catch {
        // Best-effort only — the server-rendered Order History table
        // below is still complete for every order that HAS synced.
      }
    }
    readLocal();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (pending.length === 0) return null;

  return (
    <div className="mb-4 rounded-sm border border-dashed border-amber bg-amber/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber">
        Pending sync ({pending.length})
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-graphite">
        {pending.map((order) => (
          <li key={order.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <span>
              {/* Phase 10 (§3) — the missing order number is explained
                  as a normal, expected part of "not synced yet" rather
                  than left unexplained (and never a fabricated number —
                  see order-form.tsx's own comment). */}
              <span className="font-medium">{order.failed ? "Sync failed" : "Pending sync"}</span>
              {" — order # will be assigned after sync · "}
              {formatDate(new Date(order.deliveryDate ?? order.orderDate))}
            </span>
            <span className="tabular-nums text-graphite/70">{formatMoney(order.totalAmount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-graphite/60">
        {pending.some((o) => o.failed)
          ? "Saved on this device — some changes could not reach the server yet. Nothing was lost; see the sync status menu for details."
          : "Saved on this device — will appear in Order History above, with its order number, once it reaches the server."}
      </p>
    </div>
  );
}
