"use client";

// Client component only for the confirm() prompt — the actual deletion is
// the server action passed in via `action`, already bound to the
// customer's id by the caller.
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
        className="rounded-sm border border-red-300 px-4 py-2 text-sm text-red-700 transition hover:bg-red-50"
      >
        Delete Customer
      </button>
    </form>
  );
} 
