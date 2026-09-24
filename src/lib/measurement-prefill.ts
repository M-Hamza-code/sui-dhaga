// Step 28 — fixes the S3 prefill source identified in the Step 27 audit.
//
// THE PROBLEM: S3's "measurements already filled from last visit" (design
// brief §4/§6a) was reading `customer.measurement` — the Step 1 mutable,
// single, upserted-in-place row. Saving an order has never written to that
// row (order-build.ts only ever creates a MeasurementSnapshot), so any
// correction the owner makes while measuring during an order never reached
// the next order's prefill. The Step 9 versioned snapshot system
// (MeasurementSnapshot, reached via Order.defaultMeasurementSnapshot) is
// where those corrections actually land, immutably, but nothing read from
// it for prefill purposes.
//
// THE FIX is read-only: this file adds no new write path and changes no
// existing one. `measurement-actions.ts`'s saveMeasurement() still upserts
// `customer.measurement` exactly as before; order creation still only ever
// creates snapshots, exactly as before. What changes is which of the two
// ALREADY-WRITTEN records the S3 loader treats as "the latest."
//
// WHY BOTH SOURCES STILL MATTER (so neither is silently ignored):
//   - `customer.measurement` is the only measurement source that can exist
//     before a customer's first order — Step 25's direct-to-order flow
//     always creates customer+order together, but the still-preserved
//     legacy /customers/new path can create a customer with zero orders,
//     and the standalone /measurement/edit screen is the only way to
//     record a measurement for them ahead of that first order.
//   - A customer's most recent Order.defaultMeasurementSnapshot is what
//     Step 9's versioning actually promises: the values as they stood the
//     last time the owner measured this customer for real.
// Rather than pick one and let the other silently stop mattering, this
// resolves them by recency: whichever record was actually stamped more
// recently — Measurement.updatedAt vs. the most recent snapshot-bearing
// order's createdAt — is the one that reflects the customer's last visit.
// No schema change; MeasurementSnapshot already carries no customerId of
// its own (only reachable via Order/OrderItem), so "latest snapshot for
// this customer" is necessarily read through Order, not a direct query.

import type { Measurement, MeasurementSnapshot } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The subset of fields both Measurement and MeasurementSnapshot carry
 * identically. This is deliberately narrower than either Prisma model —
 * everything downstream (order-form.tsx, order-measurement-block.tsx's
 * measurementBlockValuesFrom) only ever reads these, so either record type
 * satisfies this shape with no conversion.
 */
export interface PrefillMeasurement {
  // Index signature so this satisfies measurementBlockValuesFrom's generic
  // Record<string, unknown> parameter, exactly like the Prisma Measurement
  // type it replaces did at that same call site — every field below is
  // already assignable to `unknown`, so this adds no real looseness.
  [key: string]: unknown;
  length: Measurement["length"];
  shoulder: Measurement["shoulder"];
  sleeve: Measurement["sleeve"];
  neck: Measurement["neck"];
  chest: Measurement["chest"];
  waist: Measurement["waist"];
  hem: Measurement["hem"];
  shalwarLength: Measurement["shalwarLength"];
  pancha: Measurement["pancha"];
  shalwarPocket: Measurement["shalwarPocket"];
  shalwarGheraReady: Measurement["shalwarGheraReady"];
  note: Measurement["note"];
}

/**
 * Step 53 — exported so the Edit Order page can convert an order's own
 * MeasurementSnapshot rows (its default, and any per-suit override) into
 * the same PrefillMeasurement shape this file already uses internally —
 * one conversion, not a second copy of this field list.
 */
export function fromSnapshot(snapshot: MeasurementSnapshot): PrefillMeasurement {
  return {
    length: snapshot.length,
    shoulder: snapshot.shoulder,
    sleeve: snapshot.sleeve,
    neck: snapshot.neck,
    chest: snapshot.chest,
    waist: snapshot.waist,
    hem: snapshot.hem,
    shalwarLength: snapshot.shalwarLength,
    pancha: snapshot.pancha,
    shalwarPocket: snapshot.shalwarPocket,
    shalwarGheraReady: snapshot.shalwarGheraReady,
    note: snapshot.note,
  };
}

/**
 * The measurement values S3 should open with for an existing customer:
 * whichever of (a) their current `Measurement` row or (b) their most
 * recent order's default snapshot was actually recorded more recently.
 * Returns null only when neither exists (a genuinely never-measured
 * customer) — same as the old `customer.measurement` behaviour for that
 * case.
 *
 * Never writes anything. Never mutates a snapshot. Never touches
 * `customer.measurement`.
 */
export async function getLatestMeasurementForPrefill(customerId: string): Promise<PrefillMeasurement | null> {
  const [measurement, latestSnapshotOrder] = await Promise.all([
    prisma.measurement.findUnique({ where: { customerId } }),
    // Every order created by the current architecture (order-build.ts)
    // always creates a defaultMeasurementSnapshot; the filter below only
    // ever excludes the rare pre-Step-9 backfilled order that couldn't be
    // reconstructed with one (see schema.prisma's Order.defaultMeasurementSnapshotId comment).
    prisma.order.findFirst({
      where: { customerId, defaultMeasurementSnapshotId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { defaultMeasurementSnapshot: true },
    }),
  ]);

  const snapshot = latestSnapshotOrder?.defaultMeasurementSnapshot ?? null;

  if (!measurement && !snapshot) return null;
  if (!snapshot) return measurement;
  if (!measurement) return fromSnapshot(snapshot);

  // Both exist — the more recently recorded one wins. Measurement.updatedAt
  // is stamped by /measurement/edit's upsert every time it saves;
  // MeasurementSnapshot.createdAt is stamped once, permanently, at the
  // moment the order that produced it was saved.
  return measurement.updatedAt > snapshot.createdAt ? measurement : fromSnapshot(snapshot);
}
