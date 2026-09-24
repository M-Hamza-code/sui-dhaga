// Step 55 — offline sync Route Handler for DELETE_ORDER. Same JSON-body
// pattern as order-status/route.ts (no form fields to validate beyond
// two ids — unlike create/update, a delete has no order data of its
// own). All guard/mutation logic lives in order-delete-sync.ts's
// applyOrderDeleteSync(); nothing here duplicates it.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyOrderDeleteSync } from "@/lib/order-delete-sync";

export const dynamic = "force-dynamic";

interface OrderDeleteSyncBody {
  customerId?: unknown;
  orderId?: unknown;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: OrderDeleteSyncBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { customerId, orderId } = body ?? {};
  if (typeof customerId !== "string" || !customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }
  if (typeof orderId !== "string" || !orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const result = await applyOrderDeleteSync(customerId, orderId);

  if (!result.ok) {
    if (result.reason === "customer-not-found") {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, alreadyDeleted: result.alreadyDeleted });
}
