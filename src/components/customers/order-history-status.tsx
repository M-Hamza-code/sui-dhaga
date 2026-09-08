"use client";

// Phase 11 (§2/§4 — Customer Profile / Order History) — a small,
// additive companion to PendingOrdersNotice (Phase 6): that component
// covers orders NOT YET in the server-rendered Order History table at
// all; this one covers the opposite gap — an order ALREADY in that
// table (already synced once) whose STATUS was changed again offline
// (via the Order Detail page's OrderStatusForm, Phase 4) and hasn't
// synced yet. Without this, the plain server-rendered <StatusBadge>
// would keep showing the stale Postgres value until a full server
// re-render happens.
//
// status is the ONLY field of an existing, already-created order this
// app lets you change at all (there is no "edit order" feature for
// total/advance/delivery date/style) — so this is the one place a
// synced order's server-rendered row can go stale offline, and the one
// place worth reconciling. Reuses the EXISTING StatusBadge component
// (ui/status-badge.tsx) — same colors/labels, nothing duplicated.
import { useEffect, useState } from "react";
import type { OrderStatus } from "@prisma/client";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { StatusBadge } from "@/components/ui/status-badge";

export function OrderHistoryStatus({ orderId, serverStatus }: { orderId: string; serverStatus: OrderStatus }) {
  const [localStatus, setLocalStatus] = useState<OrderStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function readLocal() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const local = await db.orders.get(orderId);
        if (cancelled) return;
        // Only ever prefer the local value while it's genuinely still
        // unsynced — once synced, it's the same value the server just
        // rendered anyway, so the server prop stays authoritative and
        // this never overrides a case where local storage happens to
        // be stale instead (e.g. this same order in a second tab).
        if (local && local.syncStatus !== "synced") {
          setLocalStatus(local.status as OrderStatus);
        }
      } catch {
        // Best-effort only — the server-rendered value is still shown.
      }
    }
    readLocal();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return <StatusBadge status={localStatus ?? serverStatus} />;
}
