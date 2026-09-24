import { prisma } from "@/lib/prisma";
import { validateOrderInput, generateOrderNumber } from "@/lib/order-actions";
import { buildOrderCreateData } from "@/lib/order-build";
import { isUniqueConstraintError } from "@/lib/prisma-errors";

// Phase 6 (offline-first) — server-side logic for the new
// /api/sync/order-create Route Handler. Reuses, rather than duplicates:
//   - validateOrderInput() (order-actions.ts) — the exact same style/
//     money/measurement/DesignOption validation createOrder already
//     enforces. This is a "use server" file, but importing one of its
//     exports into another plain server module and calling it directly
//     is the SAME already-proven pattern customer-order-actions.ts uses
//     for this identical function (see that file's own imports) — no
//     new pattern is introduced here.
//   - generateOrderNumber() (order-actions.ts, exported since Step 25).
//   - buildOrderCreateData() (order-build.ts) — the exact nested Order/
//     snapshot/OrderItem write shape createOrder already builds.
//   - isUniqueConstraintError() (prisma-errors.ts) — the same P2002
//     retry-on-collision pattern createOrder/createCustomerAndOrder use.
// createOrder itself is not modified, called, or replaced by anything
// in this file.
//
// FormData in, not JSON: validateOrderInput's signature is FormData ->
// result, and its parsing (multiple measurement blocks, quantity-driven
// per-suit fields, a live DesignOption existence check) is too involved
// to safely re-express as a second, JSON-shaped validator without
// duplicating it. The client instead reconstructs a real FormData from
// the queue item's stored fields and posts it as multipart/form-data —
// see sync-engine.ts's enqueueCreateOrder — so this module can call
// validateOrderInput(formData) completely unchanged.

const MAX_ATTEMPTS = 5;

export type OrderCreateSyncResult =
  | { ok: true; id: string; orderNumber: string; alreadyExisted: boolean; updatedAt: string }
  | { ok: false; reason: "customer-not-found" }
  | { ok: false; reason: "invalid-input"; message: string };

/**
 * Idempotent-by-id order create — same shape as customer-sync.ts's
 * applyCustomerCreateSync. `id` is the client-generated, permanent UUID
 * (Phase 6 §B) — supplying an explicit `id` to `tx.order.create()` is
 * the same standard, already-verified Prisma behavior the Phase 1/5
 * analysis confirmed for Customer (Order.id is also
 * `String @id @default(cuid())`, a plain unconstrained Postgres `text`
 * column).
 *
 * If an order with this id already exists, that row's own orderNumber
 * is returned rather than generating a new one and rebuilding the
 * snapshot/item graph again — this is what makes a retried request
 * (network dropped after the server's write actually committed) safe:
 * it can never create a duplicate order, a duplicate orderNumber, or a
 * duplicate snapshot/item graph for the same offline-created order.
 */
export async function applyOrderCreateSync(
  id: string,
  customerId: string,
  formData: FormData,
  sessionSub: string
): Promise<OrderCreateSyncResult> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    // This is the safety net the Phase 6 "Important Dependency Rule"
    // relies on: if a customer created offline in the same session
    // hasn't synced yet (or its create permanently failed), an order
    // for that customer fails visibly here — "customer-not-found" — the
    // queue item is preserved as "rejected" (see sync-engine.ts), never
    // silently dropped or corrupted. See the Phase 6 report for the
    // full dependency-ordering analysis.
    return { ok: false, reason: "customer-not-found" };
  }

  const existing = await prisma.order.findUnique({ where: { id } });
  if (existing) {
    return { ok: true, id: existing.id, orderNumber: existing.orderNumber, alreadyExisted: true, updatedAt: existing.updatedAt.toISOString() };
  }

  const result = await validateOrderInput(formData);
  if ("error" in result) {
    return { ok: false, reason: "invalid-input", message: result.error };
  }
  const validated = result.data;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const order = await prisma.$transaction(async (tx) => {
        const orderNumber = await generateOrderNumber(tx);
        return tx.order.create({
          data: { id, ...buildOrderCreateData(customerId, orderNumber, sessionSub, validated) },
          select: { id: true, orderNumber: true, updatedAt: true },
        });
      });
      // Step 53 — updatedAt is returned so a client's very first local
      // edit of a freshly-synced order has a real baseline to send as
      // Edit Order's conflict guard (order-update.ts), rather than
      // falling back to a locally-guessed placeholder.
      return { ok: true, id: order.id, orderNumber: order.orderNumber, alreadyExisted: false, updatedAt: order.updatedAt.toISOString() };
    } catch (err) {
      if (isUniqueConstraintError(err) && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }
  // Unreachable (the loop above always either returns or throws) — kept
  // only so TypeScript sees every path return a value, matching
  // customer-sync.ts's own applyCustomerCreateSync convention.
  throw new Error("applyOrderCreateSync: exhausted retry attempts");
}
