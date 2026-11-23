// Offline sync Route Handler for SAVE_COAT_MEASUREMENT — mirrors
// api/sync/measurement/route.ts exactly. All real business logic lives in
// coat-measurement-sync.ts so this endpoint and saveCoatMeasurement can
// never enforce different rules.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyCoatMeasurementSync } from "@/lib/coat-measurement-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { customerId, ...fields } = body ?? {};
  if (typeof customerId !== "string" || !customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }

  const result = await applyCoatMeasurementSync({
    customerId,
    ...fields,
    updatedById: session.sub,
  });

  if (!result.ok) {
    if (result.reason === "customer-not-found") {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
}
