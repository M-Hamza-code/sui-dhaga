// Coat-mode equivalent of measurement-prefill.ts — resolves the Coat/
// Waistcoat values a Coat-mode order's measurement block should open with:
// whichever of (a) the customer's current CoatMeasurement row or (b) their
// most recent Coat-mode order's snapshot was actually recorded more
// recently. Same recency-resolution reasoning as the Kameez/Shalwar file
// this mirrors; see that file's own comment for the full rationale.
//
// Never writes anything. Never mutates a snapshot. Never touches
// customer.coatMeasurement.

import type { CoatMeasurement, MeasurementSnapshot } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_COAT_FIELD_KEYS } from "@/lib/coat-measurement-fields";

/** The subset of fields both CoatMeasurement and MeasurementSnapshot carry identically — mirrors PrefillMeasurement in measurement-prefill.ts. */
export interface PrefillCoatMeasurement {
  [key: string]: unknown;
  note: string | null;
}

export function coatFromSnapshot(snapshot: MeasurementSnapshot): PrefillCoatMeasurement {
  const out: PrefillCoatMeasurement = { note: snapshot.note };
  for (const key of ALL_COAT_FIELD_KEYS) {
    out[key] = (snapshot as unknown as Record<string, unknown>)[key];
  }
  return out;
}

function fromCoatMeasurement(measurement: CoatMeasurement): PrefillCoatMeasurement {
  const out: PrefillCoatMeasurement = { note: measurement.note };
  for (const key of ALL_COAT_FIELD_KEYS) {
    out[key] = (measurement as unknown as Record<string, unknown>)[key];
  }
  return out;
}

export async function getLatestCoatMeasurementForPrefill(customerId: string): Promise<PrefillCoatMeasurement | null> {
  const [measurement, latestSnapshotOrder] = await Promise.all([
    prisma.coatMeasurement.findUnique({ where: { customerId } }),
    prisma.order.findFirst({
      where: { customerId, measurementMode: "COAT", defaultMeasurementSnapshotId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { defaultMeasurementSnapshot: true },
    }),
  ]);

  const snapshot = latestSnapshotOrder?.defaultMeasurementSnapshot ?? null;

  if (!measurement && !snapshot) return null;
  if (!snapshot) return fromCoatMeasurement(measurement!);
  if (!measurement) return coatFromSnapshot(snapshot);

  return measurement.updatedAt > snapshot.createdAt ? fromCoatMeasurement(measurement) : coatFromSnapshot(snapshot);
}
