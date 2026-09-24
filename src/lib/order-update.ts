import { prisma } from "@/lib/prisma";
import { validateOrderInput } from "@/lib/order-actions";
import { buildOrderUpdateData, newOrderItemFields, updatedOrderItemFields } from "@/lib/order-build";

// Step 53 — Edit Order. Server-side logic for the new
// /api/sync/order-update Route Handler, following the exact same shape
// order-create-sync.ts's applyOrderCreateSync and customer-sync.ts's
// applyCustomerUpdateSync already established for their own ops — no new
// pattern is introduced here:
//   - validation: validateOrderInput() (order-actions.ts), completely
//     unchanged and untouched — the exact same style/money/measurement/
//     DesignOption/per-suit-style rule order creation already enforces.
//   - conflict guard: the same baseUpdatedAt last-write-wins-with-a-check
//     rule applyCustomerUpdateSync uses (Phase 5 §H) — never a blind
//     overwrite; a genuine conflict is reported, never silently applied.
//   - MeasurementSnapshot immutability: every save creates a BRAND NEW
//     snapshot (order's own default, and any per-suit override) and
//     repoints the order/item at it. The previous snapshot row is never
//     updated or deleted — it simply becomes unreferenced, exactly the
//     same "independent, frozen copy, never mutated" rule
//     schema.prisma's own MeasurementSnapshot comment describes. This is
//     what "historical measurement data remains intact" means in
//     practice: nothing before this edit is ever touched.
//
// Quantity change is the one genuinely new piece of orchestration here
// (order creation only ever creates items, never reconciles an existing
// set): OrderItem rows beyond the new quantity are deleted (never their
// MeasurementSnapshot, per the rule above); surviving positions are
// updated in place; positions beyond the old quantity are created fresh
// — using newOrderItemFields, the exact same per-item shape order
// creation's own buildOrderCreateData already produces.

export type OrderUpdateSyncResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "customer-not-found" }
  | { ok: false; reason: "order-not-found" }
  | { ok: false; reason: "invalid-input"; message: string }
  | { ok: false; reason: "conflict"; serverUpdatedAt: string };

export async function applyOrderUpdateSync(
  customerId: string,
  orderId: string,
  formData: FormData,
  baseUpdatedAt: string
): Promise<OrderUpdateSyncResult> {
  // Validate first (cheap, no DB write) — same ordering validateOrderInput's
  // other two callers (createOrder, applyOrderCreateSync) already use.
  const result = await validateOrderInput(formData);
  if ("error" in result) {
    return { ok: false, reason: "invalid-input", message: result.error };
  }
  const validated = result.data;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    return { ok: false, reason: "customer-not-found" };
  }

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  // The order must belong to the customer in the URL/payload — never act
  // on an order just because its id was guessed/reused under a different
  // customer's path. Same rule applyOrderStatusUpdate already enforces.
  if (!existing || existing.customerId !== customerId) {
    return { ok: false, reason: "order-not-found" };
  }

  if (existing.updatedAt.toISOString() !== baseUpdatedAt) {
    return { ok: false, reason: "conflict", serverUpdatedAt: existing.updatedAt.toISOString() };
  }

  const oldCount = existing.items.length;
  const newCount = validated.quantity;

  const updated = await prisma.$transaction(async (tx) => {
    // Fewer suits: drop the now-unneeded item rows. Their own
    // MeasurementSnapshot (if any) is never touched — it just becomes
    // unreferenced, same as every replaced snapshot in this flow.
    if (newCount < oldCount) {
      await tx.orderItem.deleteMany({ where: { orderId, position: { gt: newCount } } });
    }

    for (let position = 1; position <= newCount; position++) {
      const override = validated.itemOverrides[position - 1] ?? null;
      const styleOverride = validated.itemStyles[position - 1] ?? null;
      if (position <= oldCount) {
        await tx.orderItem.update({
          where: { orderId_position: { orderId, position } },
          data: updatedOrderItemFields(override, styleOverride),
        });
      } else {
        // More suits: create the newly-added positions exactly like a
        // fresh order would — never a second, drifting definition of
        // "what a new suit's row looks like".
        await tx.orderItem.create({
          data: {
            ...newOrderItemFields(override, styleOverride),
            position,
            order: { connect: { id: orderId } },
          },
        });
      }
    }

    return tx.order.update({ where: { id: orderId }, data: buildOrderUpdateData(validated) });
  });

  return { ok: true, updatedAt: updated.updatedAt.toISOString() };
}
