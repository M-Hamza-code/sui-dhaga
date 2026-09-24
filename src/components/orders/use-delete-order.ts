"use client";

// Step 56 — the confirm+enqueue+sync sequence Delete Order always uses,
// extracted out of delete-order-button.tsx (Step 55) so the new compact
// Order Board icon button (delete-order-icon-button.tsx) can reuse the
// exact same local-first deletion logic instead of a second copy of it.
// Only WHAT HAPPENS AFTER a successful delete differs between the two
// call sites (navigate away vs. refresh in place), which is why this
// takes an `onDeleted` callback rather than deciding that itself.
//
// Still exactly the Step 55 mechanism, unchanged: enqueueDeleteOrder
// (Dexie write + DELETE_ORDER syncQueue item, one transaction) ->
// processSyncQueue() fire-and-forget. No second deletion mechanism.
import { useState } from "react";
import { enqueueDeleteOrder, processSyncQueue } from "@/lib/offline/sync-engine";
import { en } from "@/lib/locale";

export function useDeleteOrder(customerId: string, orderId: string, orderNumberDisplay: string) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteOrder(onDeleted: () => void) {
    const confirmed = window.confirm(en.orderDetail.deleteOrderConfirmTemplate.replace("{order}", orderNumberDisplay));
    if (!confirmed) return;

    setError(null);
    setDeleting(true);

    const result = await enqueueDeleteOrder(customerId, orderId);
    if (!result.queued) {
      setError(en.orderDetail.deleteOrderFailed);
      setDeleting(false);
      return;
    }

    // Fire-and-forget, same as every other local-first mutation in this
    // app — the deletion is already durable locally regardless of
    // whether this succeeds immediately, later, or not at all right now.
    processSyncQueue().catch(() => {});
    onDeleted();
  }

  return { deleting, error, deleteOrder };
}
