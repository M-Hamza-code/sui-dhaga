import { prisma } from "@/lib/prisma";
import { deleteOrderCascade } from "@/lib/order-delete";

// Step 55 — server-side logic for the new /api/sync/order-delete Route
// Handler, following the exact same shape order-update.ts/
// order-create-sync.ts already established for their own ops.

export type OrderDeleteSyncResult =
  | { ok: true; alreadyDeleted: boolean }
  | { ok: false; reason: "customer-not-found" }
  | { ok: false; reason: "order-not-found" }
  | { ok: false; reason: "conflict"; serverUpdatedAt: string };

/**
 * Idempotent-by-id order delete, with an atomic version guard. `baseUpdatedAt`
 * is the local device's last-known-confirmed `updatedAt` for this order
 * (see DeleteOrderPayload's own comment in sync-engine.ts for why it is
 * captured once, at enqueue time, rather than re-resolved live).
 *
 * `order-not-found` is only returned when an order with this id
 * genuinely belongs to a DIFFERENT customer (never confirm it exists
 * elsewhere, same rule every other order endpoint already enforces) —
 * an order that simply no longer exists at all is treated as an
 * already-successful delete, not an error, which is what makes a
 * retried DELETE_ORDER queue item safe (the first attempt's response
 * never reached the client, even though it already applied).
 *
 * The version guard is a single atomic conditional `updateMany` (a
 * trivial self-touch — it changes no real field, just re-stamps
 * `updatedAt`) INSIDE the same transaction as the cascade delete: it
 * both verifies the version atomically and, because any UPDATE in
 * Postgres holds a row lock for the rest of the enclosing transaction
 * (same reasoning already relied on in order-update.ts), closes the
 * TOCTOU gap between checking the version and actually deleting —
 * without needing a separate explicit `SELECT ... FOR UPDATE`.
 * `deleteOrderCascade` itself (order-delete.ts) is NOT touched — it
 * stays the shared, version-unaware primitive customer-actions.ts's own
 * cascade delete also calls directly; the guard lives here, in the
 * sync-only caller, exactly as the already-approved design requires.
 *
 * Deliberately does NOT block on the customer being soft-deleted (unlike
 * order create/update) — deleteCustomer's own cascade (customer-actions.ts)
 * calls deleteOrderCascade directly rather than through this function,
 * but an admin correcting a mistake by deleting one remaining order for
 * an already-deleted customer must still work through this same path.
 */
export async function applyOrderDeleteSync(customerId: string, orderId: string, baseUpdatedAt: string): Promise<OrderDeleteSyncResult> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return { ok: false, reason: "customer-not-found" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
  if (!order) {
    // Already gone — same idempotent-retry treatment as before, no
    // version check possible or needed against a row that doesn't exist.
    return { ok: true, alreadyDeleted: true };
  }
  if (order.customerId !== customerId) {
    return { ok: false, reason: "order-not-found" };
  }

  return prisma.$transaction(async (tx) => {
    const conditional = await tx.order.updateMany({
      where: { id: orderId, customerId, updatedAt: new Date(baseUpdatedAt) },
      data: { updatedAt: new Date() },
    });

    if (conditional.count !== 1) {
      // Either a concurrent delete already removed it (re-check for
      // that specifically, same "already deleted is success" rule as
      // above) or it genuinely changed for some other reason.
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (!current) {
        return { ok: true, alreadyDeleted: true };
      }
      return { ok: false, reason: "conflict", serverUpdatedAt: current.updatedAt.toISOString() };
    }

    await deleteOrderCascade(tx, orderId);
    return { ok: true, alreadyDeleted: false };
  });
}
