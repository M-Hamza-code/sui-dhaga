import type { Prisma } from "@prisma/client";

// Step 55 — Delete Order / fixed Customer deletion. Plain module (not
// "use server") — the exact same reason order-build.ts/order-update.ts
// already are: this needs to be called from BOTH a "use server" file
// (order-actions.ts is NOT actually the caller — see order-delete-sync.ts;
// kept as a plain module purely so it composes inside an arbitrary
// existing Prisma.TransactionClient) and reused, unchanged, by
// customer-actions.ts's deleteCustomer() so a customer's own cascade
// delete is never a second, drifting copy of "how one order gets deleted."
//
// FK-safe deletion order for ONE order — mirrors the exact same order
// Steps 51/52/54's own cleanup scripts already established for this
// schema: OrderItem (child of both Order and MeasurementSnapshot) ->
// Order itself -> the now-unreferenced MeasurementSnapshot row(s) (the
// order's own default, and any per-suit override). Never touches
// Customer or Measurement (the customer's CURRENT/live measurement) —
// this function's only job is "make this one order, and everything that
// exists solely to describe it, gone."
export async function deleteOrderCascade(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      defaultMeasurementSnapshotId: true,
      items: { select: { measurementSnapshotId: true } },
    },
  });
  // Already gone (or never existed) — idempotent no-op, not an error.
  // Matters for the offline-sync path: a retried DELETE_ORDER queue item
  // (the first attempt's response was lost, but the delete already
  // applied) must be able to run this again safely.
  if (!order) {
    return false;
  }

  const snapshotIds = [order.defaultMeasurementSnapshotId, ...order.items.map((item) => item.measurementSnapshotId)].filter(
    (id): id is string => id !== null
  );

  await tx.orderItem.deleteMany({ where: { orderId } });
  await tx.order.delete({ where: { id: orderId } });
  if (snapshotIds.length > 0) {
    await tx.measurementSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
  }

  return true;
}
