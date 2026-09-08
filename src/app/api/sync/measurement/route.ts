// Phase 6 (offline-first) — offline sync Route Handler for
// SAVE_MEASUREMENT. Same architecture/security pattern as Phase 4/5's
// endpoints: getSession() (not requireSession(), which redirects —
// wrong for a JSON API), plain JSON in/out, and all real business logic
// lives in a shared module (measurement-sync.ts) so this endpoint and
// the existing saveMeasurement Server Action can never enforce
// different rules.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyMeasurementSync } from "@/lib/measurement-sync";

export const dynamic = "force-dynamic";

interface MeasurementSyncBody {
  customerId?: unknown;
  length?: unknown;
  shoulder?: unknown;
  sleeve?: unknown;
  neck?: unknown;
  chest?: unknown;
  waist?: unknown;
  hem?: unknown;
  shalwarLength?: unknown;
  pancha?: unknown;
  shalwarGheraReady?: unknown;
  shalwarPocket?: unknown;
  note?: unknown;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: MeasurementSyncBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { customerId, ...fields } = body ?? {};
  if (typeof customerId !== "string" || !customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }

  const result = await applyMeasurementSync({
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
