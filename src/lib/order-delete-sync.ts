import { prisma } from "@/lib/prisma";
import { deleteOrderCascade } from "@/lib/order-delete";

// Step 55 — server-side logic for the new /api/sync/order-delete Route
// Handler, following the exact same shape order-update.ts/
// order-create-sync.ts already established for their own ops.

export type OrderDeleteSyncResult =
  | { ok: true; alreadyDeleted: boolean }
  | { ok: false; reason: "customer-not-found" }
  | { ok: false; reason: "order-not-found" };

/**
 * Idempotent-by-id order delete. `order-not-found` is only returned when
 * an order with this id genuinely belongs to a DIFFERENT customer (never
 * confirm it exists elsewhere, same rule every other order endpoint
 * already enforces) — an order that simply no longer exists at all is
 * treated as an already-successful delete, not an error, which is what
 * makes a retried DELETE_ORDER queue item safe (the first attempt's
 * response never reached the client, even though it already applied).
 *
 * Deliberately does NOT block on the customer being soft-deleted (unlike
 * order create/update) — deleteCustomer's own cascade (customer-actions.ts)
 * calls deleteOrderCascade directly rather than through this function,
 * but an admin correcting a mistake by deleting one remaining order for
 * an already-deleted customer must still work through this same path.
 */
export async function applyOrderDeleteSync(customerId: string, orderId: string): Promise<OrderDeleteSyncResult> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return { ok: false, reason: "customer-not-found" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
  if (order && order.customerId !== customerId) {
    return { ok: false, reason: "order-not-found" };
  }

  const deleted = await prisma.$transaction((tx) => deleteOrderCascade(tx, orderId));
  return { ok: true, alreadyDeleted: !deleted };
}
