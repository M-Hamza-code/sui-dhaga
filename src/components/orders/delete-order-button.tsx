"use client";

// Step 55 — Part 2: Delete Order. Local-first, same established shape as
// every other order mutation in this app. Step 56 — the actual
// confirm+enqueue+sync sequence now lives in useDeleteOrder
// (use-delete-order.ts), shared with the new Order Board icon button
// (delete-order-icon-button.tsx); this component only owns what happens
// AFTER a successful delete (navigate to the customer profile) and its
// own text-button presentation — both unchanged from Step 55.
//
// Rule A (never delete the customer, never touch a different order) is
// enforced by construction, not by anything in this component: `orderId`
// is the one specific order this button was rendered for.
//
// No existing Dialog/Modal component exists in this project (confirmed
// by inspection) — window.confirm() is the SAME mechanism
// delete-customer-button.tsx already uses for its own destructive
// action; this reuses that established pattern rather than introducing
// a new one.
import { useRouter } from "next/navigation";
import { navigateAfterLocalSave } from "@/lib/offline/navigate";
import { useDeleteOrder } from "./use-delete-order";
import { en } from "@/lib/locale";

export function DeleteOrderButton({
  customerId,
  orderId,
  orderNumberDisplay,
}: {
  customerId: string;
  orderId: string;
  /** Already-formatted (formatOrderNumber) — used only in the confirmation prompt, never re-derived here. */
  orderNumberDisplay: string;
}) {
  const router = useRouter();
  const { deleting, error, deleteOrder } = useDeleteOrder(customerId, orderId, orderNumberDisplay);

  function handleClick() {
    // This order's own detail page can no longer be shown — the order
    // that page is FOR was just deleted. The customer profile is the
    // correct landing spot: still exists, still shows its other orders
    // (per Part 2's own example), and already has PendingOrdersNotice/
    // OrderHistoryStatus wired up for exactly this kind of local-first
    // reconciliation.
    deleteOrder(() => navigateAfterLocalSave(router, `/customers/${customerId}`));
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={deleting}
        className="rounded-sm border border-red-300 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-50 disabled:opacity-60"
      >
        {deleting ? en.orderDetail.deletingOrder : en.orderDetail.deleteOrderLinkLabel}
      </button>
      {error && (
        <p role="alert" className="text-xs text-amber">
          {error}
        </p>
      )}
    </div>
  );
}
