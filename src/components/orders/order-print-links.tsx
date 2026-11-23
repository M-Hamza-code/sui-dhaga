"use client";

// Follow-up audit fix — Receipt/Work Order/WhatsApp all read this order
// straight from Postgres (see order-print-data.ts); none of them can see
// this device's own Dexie copy. An order saved offline (or edited offline
// and not yet synced) can therefore 404 there today, and the generic
// not-found page's "may have been removed" wording is actively wrong for
// that case — the order wasn't removed, it just hasn't synced yet.
//
// The fix lives here, not in those pages: this is the ONLY place in the
// app that links to them, so gating the links themselves at the one
// click-through entry point covers every reachable path without touching
// the print routes or their own (already-correct, unchanged) rendering
// for a genuinely synced order.
//
// Fails OPEN by design: the default (no IndexedDB, no local row for this
// order, or a local row that's already synced) is to render the exact
// same links as before this fix existed — same markup, same hrefs. Only
// a POSITIVELY confirmed not-yet-synced local row swaps them for a
// message instead. This keeps a synced order's experience pixel-for-
// pixel identical (no new loading state, no hydration mismatch) and
// means a Dexie read failure can only ever fail toward "show the links",
// never toward hiding a legitimate print action.
import { useEffect, useState } from "react";
import Link from "next/link";
import { readOrderSyncBadge } from "@/lib/offline/sync-status";
import { en } from "@/lib/locale";

const LINK_CLASS =
  "rounded-sm border border-rule px-3.5 py-2 text-sm text-graphite transition hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1";

export function OrderPrintLinks({ customerId, orderId }: { customerId: string; orderId: string }) {
  const [pendingSync, setPendingSync] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function readLocal() {
      try {
        const badge = await readOrderSyncBadge(orderId);
        if (cancelled) return;
        if (badge !== null && badge !== "synced") {
          setPendingSync(true);
        }
      } catch {
        // Best-effort only — fail open (keep showing the links) rather
        // than guess.
      }
    }
    readLocal();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (pendingSync) {
    return <p className="rounded-sm border border-amber bg-amber/10 px-3.5 py-2 text-sm text-graphite">{en.orderDetail.printPendingSync}</p>;
  }

  return (
    <>
      <Link href={`/customers/${customerId}/orders/${orderId}/receipt`} className={LINK_CLASS}>
        {en.print.receipt.linkLabel}
      </Link>
      <Link href={`/customers/${customerId}/orders/${orderId}/work-order`} className={LINK_CLASS}>
        {en.print.workOrder.linkLabel}
      </Link>
      <Link href={`/customers/${customerId}/orders/${orderId}/whatsapp`} className={LINK_CLASS}>
        {en.whatsapp.linkLabel}
      </Link>
    </>
  );
}
