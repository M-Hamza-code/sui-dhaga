// Step 53 (offline-first) — offline sync Route Handler for UPDATE_ORDER.
// Same multipart/form-data body shape as order-create/route.ts (so
// applyOrderUpdateSync -> validateOrderInput can be reused completely
// unchanged), same 409-on-conflict shape as customer-update/route.ts. All
// guard/conflict/mutation logic lives in order-update.ts's
// applyOrderUpdateSync(); nothing here duplicates it.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyOrderUpdateSync } from "@/lib/order-update";

export const dynamic = "force-dynamic";

// Reserved field names the client adds alongside the real order fields —
// same convention order-create/route.ts already uses for its own two.
const ORDER_ID_FIELD = "__orderId";
const CUSTOMER_ID_FIELD = "__customerId";
const BASE_UPDATED_AT_FIELD = "__baseUpdatedAt";
// Required so the server-side idempotency receipt (SyncOperationReceipt)
// can be keyed on it — the client's own queue item id, stable across
// retries of the same logical edit (see sync-engine.ts's
// generateIdempotencyKey/prepareItemForDispatch).
const IDEMPOTENCY_KEY_FIELD = "__idempotencyKey";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed form data" }, { status: 400 });
  }

  const orderId = formData.get(ORDER_ID_FIELD);
  const customerId = formData.get(CUSTOMER_ID_FIELD);
  const baseUpdatedAt = formData.get(BASE_UPDATED_AT_FIELD);
  if (typeof orderId !== "string" || !orderId || typeof customerId !== "string" || !customerId) {
    return NextResponse.json({ error: `${ORDER_ID_FIELD} and ${CUSTOMER_ID_FIELD} are required` }, { status: 400 });
  }
  if (typeof baseUpdatedAt !== "string" || !baseUpdatedAt) {
    return NextResponse.json({ error: `${BASE_UPDATED_AT_FIELD} is required` }, { status: 400 });
  }
  const idempotencyKey = formData.get(IDEMPOTENCY_KEY_FIELD);
  if (typeof idempotencyKey !== "string" || !idempotencyKey) {
    return NextResponse.json({ error: `${IDEMPOTENCY_KEY_FIELD} is required` }, { status: 400 });
  }

  const result = await applyOrderUpdateSync(customerId, orderId, formData, baseUpdatedAt, idempotencyKey);

  if (!result.ok) {
    if (result.reason === "customer-not-found") {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    if (result.reason === "order-not-found") {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (result.reason === "conflict") {
      return NextResponse.json(
        { error: "This order was changed elsewhere since this edit started", serverUpdatedAt: result.serverUpdatedAt },
        { status: 409 }
      );
    }
    if (result.reason === "idempotency-key-reuse") {
      // Deliberately NOT 409 — this is not a stale-version conflict (no
      // server baseline exists to rebase onto), it's a permanent
      // rejection that should never happen under correct client
      // operation. The explicit `code` is what the client actually
      // keys its classification on, never the bare status (see
      // sync-engine.ts's sendQueueItem) — a future unrelated validation
      // error could plausibly also use 422 without meaning this.
      return NextResponse.json(
        { error: "This exact update was already recorded under a different request", code: "idempotency-key-reuse" },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
}
