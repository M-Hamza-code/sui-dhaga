"use client";

// Step 14: the order detail page's status control. Supersedes the old
// one-way "Mark as Delivered" button — a dropdown that can move an order
// through the full NEW / STITCHING / READY / DELIVERED workflow (design
// brief §8 describes the same four-stage progression, also used by the
// Step 15 Order Board).
//
// `redirectTo` (Step 15): where to land after a successful change. Left
// unset, it defaults to this same order's own detail page — the order
// detail page's original Step 14 behaviour, untouched. The Order Board
// passes its own URL instead, so this exact same component/action is
// reused there without navigating the owner away from the board.
//
// Phase 4 (offline-first) — this component's PUBLIC INTERFACE
// (customerId/orderId/status/redirectTo props) is completely unchanged,
// so neither of its two call sites (order-board-table.tsx, the Order
// Detail page) needed any modification at all. What changed internally:
// it no longer submits a <form action={updateOrderStatus}> directly (a
// live server round trip on every change) — it's now local-first:
//
//   1. On change, the new status is written to the local Dexie order
//      row + a syncQueue item is created, in ONE atomic transaction
//      (enqueueOrderStatusUpdate, sync-engine.ts) — this can never leave
//      "order looks changed" and "a queue item exists to deliver that
//      change" out of sync with each other, even across a crash.
//   2. Only once that local write is confirmed does the dropdown's own
//      displayed value update (optimistic, but never ahead of a durable
//      local write).
//   3. The sync engine then attempts delivery immediately
//      (processSyncQueue). If it succeeds this same call — the normal
//      case while online — router.refresh() re-fetches this page's
//      Server Component data, which is exactly what the OLD
//      Server-Action-redirect-to-self behavior already did in both of
//      this component's real call sites (redirectTo has always equal
//      the current page's own URL in both — the board's active tab, or
///     this same order's own detail page) — so a status change that
//      moves an order out of the Order Board's currently-viewed tab
//      still correctly makes it disappear, exactly like before.
//   4. If offline, or the sync fails for any reason, nothing here
//      throws or blocks the UI — the dropdown already shows the new
//      status, and the queued item is retried by the sync engine later
//      (see sync-queue-bootstrap.tsx).
//
// updateOrderStatus (order-actions.ts) itself is completely unchanged
// and still fully exported/working — this component just no longer
// calls it directly; the new offline-sync Route Handler
// (/api/sync/order-status) enforces the exact same rules via the same
// extracted helper (order-status-update.ts) instead.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { STATUS_TONE } from "@/components/ui/status-badge";
import { enqueueOrderStatusUpdate, processSyncQueue, isValidSelectableOrderStatus } from "@/lib/offline/sync-engine";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { en } from "@/lib/locale";

const OPTIONS: OrderStatus[] = ["NEW", "STITCHING", "READY", "DELIVERED"];

export function OrderStatusForm({
  customerId,
  orderId,
  status,
  redirectTo,
}: {
  customerId: string;
  orderId: string;
  status: OrderStatus;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [displayStatus, setDisplayStatus] = useState<OrderStatus>(status);

  // Phase 11 (§2/§4/§5) — this dropdown's own `status` prop is a
  // server-rendered snapshot (Order Board / Order Detail are both
  // Server Components). If a PREVIOUS status change from this exact
  // component made it to Dexie but hasn't synced yet (offline, or a
  // transient failure), a later page load/re-render would otherwise
  // start back from the STALE server value — this reconciles that one
  // gap on mount, the same pattern order-history-status.tsx uses for
  // the Profile's own Order History table. Never overrides a genuinely
  // synced value (server and local already agree in that case).
  useEffect(() => {
    let cancelled = false;
    async function readLocal() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const local = await db.orders.get(orderId);
        if (cancelled) return;
        if (local && local.syncStatus !== "synced" && isValidSelectableOrderStatus(local.status)) {
          setDisplayStatus(local.status);
        }
      } catch {
        // Best-effort only — the server-rendered value is still shown.
      }
    }
    readLocal();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (next === displayStatus || !isValidSelectableOrderStatus(next)) {
      return;
    }

    // Local-first: the durable local write (+ queue item) happens
    // before anything visual changes — if it somehow doesn't succeed
    // (no IndexedDB, or the local validation rejects it), the dropdown
    // is left exactly as it was rather than showing a change that was
    // never actually recorded anywhere.
    const enqueueResult = await enqueueOrderStatusUpdate({ customerId, orderId, status: next });
    if (!enqueueResult.queued) {
      return;
    }
    setDisplayStatus(next);

    const processResult = await processSyncQueue();
    if (processResult.syncedCount > 0) {
      // Reproduces the old Server-Action-redirect-to-self behavior
      // (redirectTo has always equaled the current page's own URL in
      // both real call sites) without a full navigation — see the file
      // header comment for why this is the correct equivalent.
      router.refresh();
    }
  }

  // Step 49 — the select itself tints with the exact same STATUS_TONE
  // used by StatusBadge (one source of truth), so a row's status is
  // scannable at a glance on the dense Order Board without waiting for
  // a hover/click. `redirectTo` is intentionally unused now beyond the
  // comment above — kept as a prop (not removed) so neither call site
  // needs to change; router.refresh() covers both of today's actual
  // usages of it.
  void redirectTo;

  return (
    <select
      name="status"
      value={displayStatus}
      onChange={handleChange}
      className={`rounded-sm border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-indigo ${STATUS_TONE[displayStatus]}`}
    >
      {/* PENDING is legacy — not a selectable target, but stays valid as
          the current value so a still-PENDING order renders correctly
          until it's moved forward. */}
      {displayStatus === "PENDING" && <option value="PENDING">{en.status.PENDING}</option>}
      {OPTIONS.map((value) => (
        <option key={value} value={value}>
          {en.status[value]}
        </option>
      ))}
    </select>
  );
}
