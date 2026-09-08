"use server";

// Server Action for the Customer Measurement System (Step 5).
//
// STRICT RULE: one customer has zero or exactly one Measurement row, ever.
// This is enforced by Measurement.customerId being @unique in the schema
// (see prisma/schema.prisma) and by always writing through upsert() here —
// there is no code path in this file that can create a second row for the
// same customer.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { measurementInputSchema } from "@/lib/measurement-value";

// Step 14 extracted the 10 shared decimal fields (+ shalwarPocket) into
// measurement-value.ts so order-actions.ts's snapshot validation reuses
// the exact same contract — nothing about the contract itself changed.
// Phase 6 (offline-first) moved measurementInputSchema itself (the
// +note extension) into that same module too, so the new offline sync
// path (measurement-sync.ts) can reuse it as well — this file now
// imports it instead of defining its own copy; the schema is unchanged.

export async function saveMeasurement(customerId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  // Soft-deleted customers cannot have their measurement added or edited —
  // same rule Step 3 applies to editing the customer record itself.
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    // Step 31: same "no specific page left to return to" fallback as
    // customer-actions.ts's guards — back to S1 Search/Home, not the
    // legacy /customers list.
    redirect("/dashboard");
  }

  const parsed = measurementInputSchema.safeParse({
    length: formData.get("length") || undefined,
    shoulder: formData.get("shoulder") || undefined,
    sleeve: formData.get("sleeve") || undefined,
    neck: formData.get("neck") || undefined,
    chest: formData.get("chest") || undefined,
    waist: formData.get("waist") || undefined,
    hem: formData.get("hem") || undefined,
    shalwarLength: formData.get("shalwarLength") || undefined,
    pancha: formData.get("pancha") || undefined,
    shalwarGheraReady: formData.get("shalwarGheraReady") || undefined,
    shalwarPocket: formData.get("shalwarPocket") || "",
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    redirect(`/customers/${customerId}/measurement/edit?error=${encodeURIComponent(message)}`);
  }

  const data = parsed.data;
  const shalwarPocket = data.shalwarPocket === "yes" ? true : data.shalwarPocket === "no" ? false : null;

  // Decimal fields are passed through as strings (not converted to JS
  // number) so Prisma writes the exact decimal the admin typed, with no
  // floating-point rounding.
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
    updatedById: session.sub,
  };

  // The only place a Measurement row is ever written. customerId is
  // @unique, so this always either creates the customer's first (and
  // only) row, or overwrites their existing one in place — same id, same
  // row, old values gone.
  await prisma.measurement.upsert({
    where: { customerId },
    create: { customerId, ...measurementData },
    update: measurementData,
  });

  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}
