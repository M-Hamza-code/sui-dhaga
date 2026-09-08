import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@prisma/client";

// Phase 4 (offline-first) — extracted from order-actions.ts's
// updateOrderStatus, following the exact same pattern this codebase
// already established in Step 25 (customer-validation.ts, order-build.ts):
// a "use server" file's exports must all be async Server Actions, and
// this same guard/mutation logic now needs a second caller — the new
// offline-sync Route Handler (src/app/api/sync/order-status/route.ts) —
// so it moved into its own plain module rather than being duplicated.
//
// This function deliberately never calls Next's redirect() or reads
// FormData itself — those are presentation/transport concerns each
// caller owns independently (a page-redirecting Server Action vs. a
// JSON-responding Route Handler), exactly like validateOrderInput()
// already does for order creation. updateOrderStatus() in
// order-actions.ts now calls this and reproduces its exact previous
// redirect behavior from the result — see that file for the comparison.

const STATUS_OPTIONS = [OrderStatus.NEW, OrderStatus.STITCHING, OrderStatus.READY, OrderStatus.DELIVERED] as const;

export function isValidOrderStatusValue(value: unknown): value is OrderStatus {
  return (STATUS_OPTIONS as readonly string[]).includes(value as string);
}

export type OrderStatusUpdateResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "customer-not-found" | "order-not-found" | "invalid-status" };

/**
 * The exact guard + mutation sequence updateOrderStatus has always
 * performed: customer must exist and not be soft-deleted, the order must
 * exist and belong to that customer, and the submitted status (if valid
 * and different) is applied with a plain `prisma.order.update`. This
 * database operation is naturally idempotent — re-applying the same
 * status to the same order twice produces the identical end state both
 * times, with no duplicate side effects — which is exactly what the
 * offline sync engine's retry behavior depends on (see sync-engine.ts).
 */
export async function applyOrderStatusUpdate(
  customerId: string,
  orderId: string,
  rawStatus: unknown
): Promise<OrderStatusUpdateResult> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    return { ok: false, reason: "customer-not-found" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  // The order must belong to the customer in the URL/payload — never act
  // on an order just because its id was guessed/reused under a different
  // customer's path. Same rule updateOrderStatus has always enforced.
  if (!order || order.customerId !== customerId) {
    return { ok: false, reason: "order-not-found" };
  }

  if (!isValidOrderStatusValue(rawStatus)) {
    return { ok: false, reason: "invalid-status" };
  }

  const changed = rawStatus !== order.status;
  if (changed) {
    await prisma.order.update({ where: { id: orderId }, data: { status: rawStatus } });
  }

  return { ok: true, changed };
}
