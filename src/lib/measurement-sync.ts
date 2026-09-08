import { prisma } from "@/lib/prisma";
import { measurementInputSchema, shalwarPocketToBoolean } from "@/lib/measurement-value";

// Phase 6 (offline-first) — server-side logic for the new
// /api/sync/measurement Route Handler. Reuses, rather than duplicates:
//   - measurementInputSchema (measurement-value.ts) — the exact same
//     rule saveMeasurement (measurement-actions.ts) has always enforced
//     (Step 5), now shared from its own plain module (see that file's
//     Phase 6 comment for why it had to move there).
//   - the same "" / "yes" / "no" -> null / true / false mapping, via the
//     already-exported shalwarPocketToBoolean() helper.
// saveMeasurement itself is not modified, called, or replaced by
// anything in this file.
//
// Idempotency note: unlike Customer/Order, Measurement has no separate
// "does this id already exist" question to ask — customerId is the
// real, @unique key (one customer, zero or one Measurement row, ever),
// and prisma.measurement.upsert() is applied against THAT key, exactly
// like saveMeasurement already does. Sending the identical values twice
// (a genuine retry of the same offline edit) always upserts to the same
// end state — there is no way for a retry to create a duplicate row or
// apply a value twice, so no separate "already applied" check is
// needed here.
//
// Conflict detection: this intentionally applies the SAME last-write-
// wins behavior saveMeasurement (the existing online path) already has
// — no version/baseUpdatedAt guard is added here. The original Phase 1
// architecture flagged Measurement as a place a silent overwrite could
// matter more than for other records; adding a guard here would create
// a real asymmetry between the online and offline paths (the online
// Server Action would still blindly overwrite, the offline path
// wouldn't), which is its own kind of inconsistency. This is called out
// explicitly in the Phase 6 report as a known limitation, not silently
// decided.

export type MeasurementSyncResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "customer-not-found" }
  | { ok: false; reason: "invalid-input"; message: string };

export async function applyMeasurementSync(input: {
  customerId: string;
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
  updatedById: string | null;
}): Promise<MeasurementSyncResult> {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer || customer.deletedAt) {
    return { ok: false, reason: "customer-not-found" };
  }

  const parsed = measurementInputSchema.safeParse({
    length: input.length || undefined,
    shoulder: input.shoulder || undefined,
    sleeve: input.sleeve || undefined,
    neck: input.neck || undefined,
    chest: input.chest || undefined,
    waist: input.waist || undefined,
    hem: input.hem || undefined,
    shalwarLength: input.shalwarLength || undefined,
    pancha: input.pancha || undefined,
    shalwarGheraReady: input.shalwarGheraReady || undefined,
    shalwarPocket: input.shalwarPocket || "",
    note: input.note || undefined,
  });

  if (!parsed.success) {
    return { ok: false, reason: "invalid-input", message: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }

  const data = parsed.data;
  const shalwarPocket = shalwarPocketToBoolean(data.shalwarPocket);

  const measurementData = {
    length: data.length ?? null,
    shoulder: data.shoulder ?? null,
    sleeve: data.sleeve ?? null,
    neck: data.neck ?? null,
    chest: data.chest ?? null,
    waist: data.waist ?? null,
    hem: data.hem ?? null,
    shalwarLength: data.shalwarLength ?? null,
    pancha: data.pancha ?? null,
    shalwarGheraReady: data.shalwarGheraReady ?? null,
    shalwarPocket,
    note: data.note ?? null,
    updatedById: input.updatedById,
  };

  // The only place other than saveMeasurement that a Measurement row is
  // ever written — customerId is @unique, so this always either creates
  // the customer's first (and only) row or overwrites their existing
  // one in place, exactly like saveMeasurement's own upsert.
  const updated = await prisma.measurement.upsert({
    where: { customerId: input.customerId },
    create: { customerId: input.customerId, ...measurementData },
    update: measurementData,
  });

  return { ok: true, updatedAt: updated.updatedAt.toISOString() };
}
