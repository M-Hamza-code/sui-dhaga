import { prisma } from "@/lib/prisma";
import { coatMeasurementInputSchema } from "@/lib/coat-measurement-value";
import { ALL_COAT_FIELD_KEYS } from "@/lib/coat-measurement-fields";

// Server-side logic for the /api/sync/coat-measurement Route Handler — the
// Coat-mode equivalent of measurement-sync.ts's applyMeasurementSync().
// Reuses coatMeasurementInputSchema so the online (saveCoatMeasurement) and
// offline paths can never enforce different rules, same reasoning as the
// Kameez/Shalwar file this mirrors. Same last-write-wins behavior, no
// baseUpdatedAt conflict guard — matching the existing Measurement sync's
// own documented, deliberate limitation.

export type CoatMeasurementSyncResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "customer-not-found" }
  | { ok: false; reason: "invalid-input"; message: string };

export async function applyCoatMeasurementSync(input: {
  customerId: string;
  [key: string]: unknown;
  updatedById: string | null;
}): Promise<CoatMeasurementSyncResult> {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer || customer.deletedAt) {
    return { ok: false, reason: "customer-not-found" };
  }

  const raw: Record<string, unknown> = {};
  for (const key of ALL_COAT_FIELD_KEYS) {
    raw[key] = input[key] || undefined;
  }
  const parsed = coatMeasurementInputSchema.safeParse({ ...raw, note: input.note || undefined });

  if (!parsed.success) {
    return { ok: false, reason: "invalid-input", message: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }

  const data = parsed.data;
  const coatMeasurementData: Record<string, string | null> = { note: data.note ?? null };
  for (const key of ALL_COAT_FIELD_KEYS) {
    coatMeasurementData[key] = (data as Record<string, string | undefined>)[key] ?? null;
  }

  const updated = await prisma.coatMeasurement.upsert({
    where: { customerId: input.customerId },
    create: { customerId: input.customerId, ...coatMeasurementData, updatedById: input.updatedById },
    update: { ...coatMeasurementData, updatedById: input.updatedById },
  });

  return { ok: true, updatedAt: updated.updatedAt.toISOString() };
}
