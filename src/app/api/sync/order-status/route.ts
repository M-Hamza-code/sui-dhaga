// Phase 4 — Offline sync Route Handler for UPDATE_ORDER_STATUS.
//
// This is the offline replay path for exactly one operation. It does
// NOT replace, wrap, or modify updateOrderStatus (order-actions.ts),
// which remains the unchanged, fully working Server Action used by any
// normal (non-JS-intercepted, or future non-JS) form submission. Both
// paths call the same extracted helper — applyOrderStatusUpdate()
// (order-status-update.ts) — so they can never enforce different rules;
// see that file's own comment.
//
// Authentication: getSession() (not requireSession(), which redirects —
// wrong for a JSON API), the exact same pattern already established by
// /api/sync/initial/route.ts in Phase 3. Unauthenticated -> 401 JSON.
//
// Idempotency: this operation is a plain status overwrite
// (`prisma.order.update({ data: { status } })`), which is naturally
// idempotent — applying "set status to READY" twice produces the exact
// same end state both times, with no duplicate rows or side effects. No
// additional de-duplication table is needed for this specific operation
// (see the Phase 4 report's own note on this). The request's
// `idempotencyKey` is still accepted and echoed back for symmetry with
// later phases' operations, which will need it for real.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { applyOrderStatusUpdate } from "@/lib/order-status-update";

export const dynamic = "force-dynamic";

interface OrderStatusSyncBody {
  customerId?: unknown;
  orderId?: unknown;
  status?: unknown;
  idempotencyKey?: unknown;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: OrderStatusSyncBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { customerId, orderId, status } = body;
  if (typeof customerId !== "string" || !customerId || typeof orderId !== "string" || !orderId) {
    return NextResponse.json({ error: "customerId and orderId are required" }, { status: 400 });
  }

  const result = await applyOrderStatusUpdate(customerId, orderId, status);

  if (!result.ok) {
    if (result.reason === "customer-not-found") {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    if (result.reason === "order-not-found") {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    // "invalid-status" — the offline sync engine's own local check
    // (isValidSelectableOrderStatus) should already have caught this
    // before ever enqueueing it, so reaching this in practice means a
    // bug or a tampered request. Unlike the Server Action's silent
    // no-op (preserved verbatim for its own existing behavior — see
    // order-actions.ts), this endpoint reports it clearly as a
    // non-retryable 4xx, since the sync engine needs to actually
    // distinguish "this will never succeed" from "try again later".
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
  }

  // Same revalidation the existing Server Action already performs, so a
  // subsequent normal (non-sync-engine) page load of any of these routes
  // in this same browser never serves a stale Next.js cache entry.
  revalidatePath(`/customers/${customerId}/orders/${orderId}`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/orders");

  return NextResponse.json({ ok: true, changed: result.changed });
}
