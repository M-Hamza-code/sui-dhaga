"use client";

// Step 53 — Edit Order. Order Detail is a plain server-rendered page (it
// always has been — see order-print-data.ts's own comment on why the
// edit form's initial load doesn't try to be local-first). Saving an
// edit is local-first and fire-and-forget (order-form.tsx's handleSubmit
// doesn't await the sync before navigating back here, matching every
// other local-first form in this app), so a save made while offline — or
// one whose background sync simply hasn't finished by the time this page
// re-renders — can briefly leave this page showing the PRE-edit values
// with no indication anything changed. This is the exact same class of
// gap order-history-status.tsx already closed for order STATUS
// specifically; this closes it honestly for everything else Step 53
// makes editable, without turning the rest of this page into a
// local-first-rendered component tree (out of scope — see the Step 53
// task's own "do not redesign the entire Order Detail page" instruction).
//
// Deliberately only ever ADDS a visible notice — it never substitutes
// local values into the page's own already-rendered fields (measurements,
// styles, payment, delivery date), so there is no risk of half-updating
// the page with a mismatched partial local shape. The honest message is
// "what you see below may be a beat behind — the real change is saved",
// not an attempt to reconstruct the full edited view client-side.
import { useEffect, useState } from "react";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { en } from "@/lib/locale";

export function OrderPendingEditNotice({ orderId }: { orderId: string }) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function readLocal() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const local = await db.orders.get(orderId);
        if (cancelled) return;
        // Same "only ever while genuinely still unsynced" rule
        // order-history-status.tsx already uses — once synced, this is
        // the same value the server just rendered anyway.
        if (local && local.syncStatus !== "synced") {
          setPending(true);
        }
      } catch {
        // Best-effort only — say nothing rather than guess.
      }
    }
    readLocal();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (!pending) return null;

  return (
    <p className="mt-4 rounded-sm border border-amber bg-amber/10 px-4 py-2 text-sm text-graphite">{en.orderDetail.pendingEditNotice}</p>
  );
}
