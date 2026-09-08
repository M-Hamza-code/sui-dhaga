"use client";

// Phase 5 (offline-first) — the Customer Profile's identity header,
// extracted out of /customers/[customerId]/page.tsx into its own client
// component so it can do one small additional thing the rest of that
// page still doesn't: check the local Dexie mirror for this customer
// and prefer ITS values when present ("local storage is the source of
// truth"), which covers two cases the server-rendered page alone can't:
//   1. A customer created offline, not yet synced — Postgres has
//      nothing for this id yet, but the local row does, so the profile
//      still shows their name/phone/address (with a "Pending sync…"
//      customer-code state) instead of a bare 404.
//   2. An existing, already-synced customer with a local edit still
//      queued — the local row's values are newer than what the last
//      server render shows, so they win here too.
//
// Deliberately narrow in scope: this component only ever renders the
// identity block + primary/secondary actions. Order History and Saved
// Measurements (SectionCards below it on the page) are completely
// untouched, still rendered directly by the Server Component from
// whatever Postgres has (empty/default states for a customer that
// doesn't exist there yet — which is exactly what a genuinely brand-new
// synced customer would also show, so nothing here is inconsistent).
import { useEffect, useState } from "react";
import Link from "next/link";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { readCustomerSyncBadge, type SyncState } from "@/lib/offline/sync-status";
import { DeleteCustomerButton } from "@/components/customers/delete-customer-button";
import { en } from "@/lib/locale";

// Phase 7 (Part C/F), wording refreshed in Phase 10 (§4/§7) — plain-
// English label + explanatory line for each of the 4 states
// readCustomerSyncBadge() can return. "synced" shows nothing extra (the
// existing, unchanged default). Deliberately not reusing
// sync-status.ts's syncStateLabel() as-is: that one describes the whole
// QUEUE ("Pending changes", "Conflict needs attention"), whereas this
// is about ONE customer record — same underlying SyncState values, just
// wording appropriate to a single record rather than the whole queue.
//
// Phase 10's own guiding rule: a user must never think their data was
// lost just because it hasn't synced yet. "Saved on this device" is
// always the first thing said for a pending customer — the fact that a
// server customer code doesn't exist yet is explained as a simple
// consequence of that (never phrased as if something is wrong).
const CUSTOMER_BADGE_TEXT: Record<Exclude<SyncState, "synced" | "syncing">, string> = {
  pending: "Saved on this device",
  failed: "Sync failed",
  conflict: "Needs attention",
};
const CUSTOMER_BADGE_DETAIL: Record<Exclude<SyncState, "synced" | "syncing">, string> = {
  pending: "Customer ID will be assigned once this reaches the server.",
  failed: "Your changes are safely saved here — we'll keep trying to reach the server.",
  conflict: "This customer's information was changed somewhere else and needs review before it can sync.",
};

export interface ServerCustomerIdentity {
  name: string;
  phonePrimary: string;
  customerCode: string | null;
  isDeleted: boolean;
  orderMeta: string;
}

export function CustomerIdentityCard({
  customerId,
  serverCustomer,
  deleteAction,
}: {
  customerId: string;
  /** From the server-rendered page's own Prisma read — null if Postgres has no row for this id yet. */
  serverCustomer: ServerCustomerIdentity | null;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [local, setLocal] = useState<{ name: string; phonePrimary: string; customerCode: string | null; syncStatus: string } | null>(null);
  const [checkedLocal, setCheckedLocal] = useState(false);
  const [badge, setBadge] = useState<SyncState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function readLocal() {
      if (!isOfflineDbAvailable()) {
        if (!cancelled) setCheckedLocal(true);
        return;
      }
      try {
        const db = getOfflineDb();
        await db.open();
        const row = await db.customers.get(customerId);
        if (cancelled) return;
        if (row && !row.deletedAt) {
          setLocal({ name: row.name, phonePrimary: row.phonePrimary, customerCode: row.customerCode, syncStatus: row.syncStatus });
        }
      } finally {
        if (!cancelled) setCheckedLocal(true);
      }
    }
    readLocal();
    // Phase 7 — same reasoning as the read above, kept as a second,
    // independent effect rather than folded into readLocal(): the badge
    // additionally needs to look at the syncQueue (not just this
    // customer's own row), which readCustomerSyncBadge() already
    // encapsulates rather than duplicating here.
    readCustomerSyncBadge(customerId).then((result) => {
      if (!cancelled) setBadge(result);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Local data wins when present — see file header. Falls back to
  // whatever the server rendered otherwise.
  const name = local?.name ?? serverCustomer?.name;
  const phonePrimary = local?.phonePrimary ?? serverCustomer?.phonePrimary;
  const customerCode = local ? local.customerCode : (serverCustomer?.customerCode ?? null);
  const isDeleted = serverCustomer?.isDeleted ?? false;
  const orderMeta = serverCustomer?.orderMeta ?? en.search.noOrders;
  // Synced = has a real server customerCode. New Order and Delete both
  // depend on a real, server-side Order/Customer row existing already —
  // deliberately not offered yet for a customer still pending its own
  // create-sync (out of this phase's scope; editing still works
  // regardless, via EditCustomerForm's own Dexie-first read).
  const isSynced = customerCode !== null;

  if (!name || !phonePrimary) {
    if (checkedLocal) {
      return (
        <div className="rounded-sm border border-dashed border-rule bg-card p-6 text-center text-sm text-graphite/60">
          This customer could not be found, locally or on the server.
        </div>
      );
    }
    return null;
  }

  return (
    <div className="rounded-sm border border-rule bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-indigo text-xl font-semibold text-white">
            {name.charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-graphite">{name}</h1>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="tabular-nums text-lg text-graphite">{phonePrimary}</span>
              <span className="text-sm text-graphite/50">{orderMeta}</span>
            </div>
            {/* Phase 5's original "Pending sync…" note is now one case
                of the 4-state badge below (Phase 7 §C/§F, reworded in
                Phase 10 §4/§7) — a customer that's actually synced
                (badge null or "synced") still shows nothing extra,
                unchanged. */}
            {badge && badge !== "synced" && badge !== "syncing" && (
              <div className="mt-1">
                <p className={`text-xs font-medium ${badge === "pending" ? "text-amber" : "text-red-700"}`}>{CUSTOMER_BADGE_TEXT[badge]}</p>
                <p className="mt-0.5 text-xs text-graphite/60">{CUSTOMER_BADGE_DETAIL[badge]}</p>
              </div>
            )}
          </div>
        </div>

        {!isDeleted && isSynced && (
          <Link
            href={`/customers/${customerId}/orders/new`}
            className="rounded-sm bg-indigo px-6 py-3 text-base text-white transition hover:bg-indigo-hover"
          >
            {en.profile.newOrder}
          </Link>
        )}
      </div>

      {!isDeleted && (
        <div className="mt-5 flex gap-3 border-t border-rule pt-4">
          <Link
            href={`/customers/${customerId}/edit`}
            className="rounded-sm border border-rule px-4 py-2 text-sm text-graphite transition hover:bg-paper"
          >
            {en.profile.editCustomer}
          </Link>
          {isSynced && <DeleteCustomerButton action={deleteAction} customerName={name} />}
        </div>
      )}
    </div>
  );
}
