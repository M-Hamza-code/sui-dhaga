"use client";

// Client component only for the confirm() prompt — the actual deletion is
// the server action passed in via `action`, already bound to the
// customer's id by the caller.
import { en } from "@/lib/locale";
import { isBrowserOnline } from "@/lib/offline/online-status";
export function DeleteCustomerButton({
  action,
  customerName,
}: {
  action: (formData: FormData) => Promise<void>;
  customerName: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        // Deletion has no offline-queue path at all (unlike every other
        // mutation in this app) — a submit attempt while offline would
        // otherwise just fail silently/unexplained at the network layer.
        // This is a best-effort guard only, same caveat as every other
        // isBrowserOnline() call site in this codebase.
        if (!isBrowserOnline()) {
          event.preventDefault();
          window.alert(en.profile.deleteCustomerOfflineMessage);
          return;
        }
        // Step 55 — reworded: deleteCustomer (customer-actions.ts) now
        // also cascades to delete every one of this customer's orders
        // (and dependent order items/measurement snapshots), fixing the
        // bug where a deleted customer's orders kept showing up in Order
        // Board/Recent Orders. The customer record itself is still only
        // soft-deleted (kept, per the existing customerCode-reservation
        // rule) — unchanged — so this now accurately describes both
        // halves of what actually happens.
        const confirmed = window.confirm(
          `Delete ${customerName}? Their orders and related records will also be removed. They will be removed from customer lists and search, but their own record is kept.`
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-sm border border-red-300 px-4 py-2 text-sm text-red-700 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
      >
        {en.profile.deleteCustomer}
      </button>
    </form>
  );
} 
