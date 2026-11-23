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
  | { ok: true; changed: boolean; updatedAt: string }
  | { ok: false; reason: "customer-not-found" | "order-not-found" | "invalid-status" }
  | { ok: false; reason: "conflict"; serverUpdatedAt: string };

/**
 * The exact guard + mutation sequence updateOrderStatus has always
 * performed: customer must exist and not be soft-deleted, the order must
 * exist and belong to that customer, and the submitted status (if valid
 * and different) is applied.
 *
 * `baseUpdatedAt` is OPTIONAL and used only by the offline sync path
 * (the Route Handler always supplies it): when given, the write is an
 * atomic conditional `updateMany` (no separate read-then-write — no
 * TOCTOU gap), guarding against overwriting a change this device hasn't
 * seen yet. When omitted (the plain online Server Action in
 * order-actions.ts, a single round-trip against data it just read),
 * this keeps its original unconditional behavior unchanged — there is
 * no stale-offline-queue concept for that caller, so adding a baseline
 * check there would only add complexity without a real race to guard
 * against.
 *
 * Requesting the status the order ALREADY has is always a safe,
 * idempotent no-op regardless of baseline — exactly like
 * applyCustomerUpdateSync's content-equality short-circuit — which is
 * what lets a retried request (or a genuine concurrent duplicate) for
 * the same change succeed instead of reporting a false conflict.
 */
export async function applyOrderStatusUpdate(
  customerId: string,
  orderId: string,
  rawStatus: unknown,
  baseUpdatedAt?: string
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

  if (rawStatus === order.status) {
    return { ok: true, changed: false, updatedAt: order.updatedAt.toISOString() };
  }

  if (baseUpdatedAt === undefined) {
    const updated = await prisma.order.update({ where: { id: orderId }, data: { status: rawStatus } });
    return { ok: true, changed: true, updatedAt: updated.updatedAt.toISOString() };
  }

  const conditional = await prisma.order.updateMany({
    where: { id: orderId, customerId, updatedAt: new Date(baseUpdatedAt) },
    data: { status: rawStatus },
  });

  if (conditional.count !== 1) {
    const current = await prisma.order.findUnique({ where: { id: orderId } });
    if (!current) {
      return { ok: false, reason: "order-not-found" };
    }
    if (current.status === rawStatus) {
      // A concurrent request already applied this exact change (or this
      // is our own retry racing itself) — idempotent success.
      return { ok: true, changed: false, updatedAt: current.updatedAt.toISOString() };
    }
    return { ok: false, reason: "conflict", serverUpdatedAt: current.updatedAt.toISOString() };
  }

  const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return { ok: true, changed: true, updatedAt: updatedOrder.updatedAt.toISOString() };
}
