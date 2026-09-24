// Phase 6 (offline-first) — offline sync Route Handler for CREATE_ORDER.
// Same auth/JSON-response pattern as every other /api/sync/* endpoint,
// but the REQUEST body is multipart/form-data, not JSON — see
// order-create-sync.ts's file header for why (validateOrderInput's
// FormData-shaped contract is reused unchanged rather than duplicated).
// `request.formData()` is a standard Web API, fully supported by Next.js
// Route Handlers.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyOrderCreateSync } from "@/lib/order-create-sync";

export const dynamic = "force-dynamic";

// Reserved field names the client adds alongside the real order fields
// (see sync-engine.ts's enqueueCreateOrder) — chosen to never collide
// with anything validateOrderInput itself reads (orderDate, suitType,
// totalAmount, "default.*", "item.N.*", etc.).
const ID_FIELD = "__clientOrderId";
const CUSTOMER_ID_FIELD = "__customerId";

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

  const id = formData.get(ID_FIELD);
  const customerId = formData.get(CUSTOMER_ID_FIELD);
  if (typeof id !== "string" || !id || typeof customerId !== "string" || !customerId) {
    return NextResponse.json({ error: `${ID_FIELD} and ${CUSTOMER_ID_FIELD} are required` }, { status: 400 });
  }

  const result = await applyOrderCreateSync(id, customerId, formData, session.sub);

  if (!result.ok) {
    if (result.reason === "customer-not-found") {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    orderNumber: result.orderNumber,
    alreadyExisted: result.alreadyExisted,
    // Step 53 — see order-create-sync.ts's own comment on why this is
    // now returned.
    updatedAt: result.updatedAt,
  });
}
