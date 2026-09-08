// Phase 5 (offline-first) — offline sync Route Handler for
// UPDATE_CUSTOMER. Same pattern as customer-create/route.ts and Phase
// 4's order-status endpoint. All guard/version/mutation logic lives in
// customer-sync.ts's applyCustomerUpdateSync(), shared with nothing else
// yet (updateCustomer, the existing Server Action, remains completely
// separate and unmodified).
//
// Returns 409 with the current server updatedAt on a genuine conflict
// (Phase 5 §H) — this endpoint never silently overwrites a customer that
// changed elsewhere since the client's edit was based on it. No
// conflict-resolution UI is implemented here; the queue item is simply
// left safely stored (see sync-engine.ts) for a future phase to resolve.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyCustomerUpdateSync } from "@/lib/customer-sync";

export const dynamic = "force-dynamic";

interface CustomerUpdateSyncBody {
  customerId?: unknown;
  name?: unknown;
  phonePrimary?: unknown;
  phoneSecondary?: unknown;
  address?: unknown;
  baseUpdatedAt?: unknown;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CustomerUpdateSyncBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { customerId, name, phonePrimary, phoneSecondary, address, baseUpdatedAt } = body ?? {};
  if (typeof customerId !== "string" || !customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }
  if (typeof baseUpdatedAt !== "string" || !baseUpdatedAt) {
    return NextResponse.json({ error: "baseUpdatedAt is required" }, { status: 400 });
  }

  const result = await applyCustomerUpdateSync({ customerId, name, phonePrimary, phoneSecondary, address, baseUpdatedAt });

  if (!result.ok) {
    if (result.reason === "not-found") {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    if (result.reason === "conflict") {
      return NextResponse.json(
        { error: "This customer was changed elsewhere since this edit started", serverUpdatedAt: result.serverUpdatedAt },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
}
