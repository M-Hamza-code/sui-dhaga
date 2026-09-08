// Phase 5 (offline-first) — offline sync Route Handler for
// CREATE_CUSTOMER. Same architecture/security pattern as Phase 4's
// /api/sync/order-status: getSession() (not requireSession(), which
// redirects — wrong for a JSON API), plain JSON in/out, and all real
// business logic lives in a shared module (customer-sync.ts) so this
// endpoint and the existing createCustomer Server Action can never
// enforce different rules.
//
// Idempotency: applyCustomerCreateSync() is idempotent-by-id (see that
// file's own comment) — a retried request for the same client-generated
// id can never create a duplicate customer or consume a second
// sequential customerCode.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyCustomerCreateSync } from "@/lib/customer-sync";

export const dynamic = "force-dynamic";

interface CustomerCreateSyncBody {
  id?: unknown;
  name?: unknown;
  phonePrimary?: unknown;
  phoneSecondary?: unknown;
  address?: unknown;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CustomerCreateSyncBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { id, name, phonePrimary, phoneSecondary, address } = body ?? {};
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const result = await applyCustomerCreateSync({
    id,
    name,
    phonePrimary,
    phoneSecondary,
    address,
    createdById: session.sub,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    customerCode: result.customerCode,
    alreadyExisted: result.alreadyExisted,
  });
}
