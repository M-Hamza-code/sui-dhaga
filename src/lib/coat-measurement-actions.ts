"use server";

// Server Action for the Prince Coat/Waistcoat Measurement profile — the
// Coat-mode equivalent of measurement-actions.ts's saveMeasurement().
//
// STRICT RULE: one customer has zero or exactly one CoatMeasurement row,
// ever — enforced by CoatMeasurement.customerId being @unique (see
// prisma/schema.prisma) and by always writing through upsert() here.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { coatMeasurementInputSchema } from "@/lib/coat-measurement-value";
import { ALL_COAT_FIELD_KEYS } from "@/lib/coat-measurement-fields";

export async function saveCoatMeasurement(customerId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  // Soft-deleted customers cannot have their measurement added or edited —
  // same rule saveMeasurement already applies.
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    redirect("/dashboard");
  }

  const raw: Record<string, FormDataEntryValue | undefined> = {};
  for (const key of ALL_COAT_FIELD_KEYS) {
    raw[key] = formData.get(key) || undefined;
  }
  const parsed = coatMeasurementInputSchema.safeParse({
    ...raw,
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    redirect(`/customers/${customerId}/coat-measurement/edit?error=${encodeURIComponent(message)}`);
  }

  const data = parsed.data;
  // Decimal fields are passed through as strings (not converted to JS
  // number) so Prisma writes the exact decimal the admin typed, with no
  // floating-point rounding — same rule saveMeasurement follows.
  const coatMeasurementData: Record<string, string | null> = { note: data.note ?? null };
  for (const key of ALL_COAT_FIELD_KEYS) {
    coatMeasurementData[key] = (data as Record<string, string | undefined>)[key] ?? null;
  }

  await prisma.coatMeasurement.upsert({
    where: { customerId },
    create: { customerId, ...coatMeasurementData, updatedById: session.sub },
    update: { ...coatMeasurementData, updatedById: session.sub },
  });

  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}
