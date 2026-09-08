import { prisma } from "@/lib/prisma";
import { generateCustomerCode } from "@/lib/customer-actions";
import { customerInputSchema } from "@/lib/customer-validation";
import { isUniqueConstraintError } from "@/lib/prisma-errors";

// Phase 5 (offline-first) — server-side logic for the two new
// /api/sync/customer-* Route Handlers. Reuses, rather than duplicates:
//   - customerInputSchema (customer-validation.ts) — the exact same
//     name/phonePrimary/phoneSecondary/address rule createCustomer and
//     updateCustomer have always enforced (Step 3).
//   - generateCustomerCode() (customer-actions.ts) — already exported
//     since Step 25 specifically so a second caller could reuse it
//     without duplicating the "read MAX(customerCode), +1, retry on
//     collision" logic.
// Neither createCustomer nor updateCustomer (customer-actions.ts) is
// modified, called, or replaced by anything in this file.

const MAX_ATTEMPTS = 5;

export type CustomerCreateSyncResult =
  | { ok: true; id: string; customerCode: string; alreadyExisted: boolean }
  | { ok: false; reason: "invalid-input"; message: string };

/**
 * Idempotent-by-id customer create. `input.id` is the client-generated,
 * permanent UUID (Phase 5 §D) — Prisma's `id String @id @default(cuid())`
 * only applies that default when `id` is omitted from `data`; supplying
 * one explicitly is standard, fully-supported behavior (verified against
 * the actual schema/every existing create call — see the Phase 5 report).
 *
 * If a customer with this id already exists, that row's OWN
 * customerCode is returned rather than generating a new one — this is
 * what makes a retried request (e.g. the first attempt's response never
 * reached the client, even though it succeeded server-side) safe: it
 * can never create a duplicate customer or consume a second sequential
 * code for the same offline-created record.
 */
export async function applyCustomerCreateSync(input: {
  id: string;
  name: unknown;
  phonePrimary: unknown;
  phoneSecondary: unknown;
  address: unknown;
  createdById: string | null;
}): Promise<CustomerCreateSyncResult> {
  const parsed = customerInputSchema.safeParse({
    name: input.name,
    phonePrimary: input.phonePrimary,
    phoneSecondary: input.phoneSecondary || undefined,
    address: input.address || undefined,
  });
  if (!parsed.success) {
    return { ok: false, reason: "invalid-input", message: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }

  const existing = await prisma.customer.findUnique({ where: { id: input.id } });
  if (existing) {
    return { ok: true, id: existing.id, customerCode: existing.customerCode, alreadyExisted: true };
  }

  const { name, phonePrimary, phoneSecondary, address } = parsed.data;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const customer = await prisma.$transaction(async (tx) => {
        const customerCode = await generateCustomerCode(tx);
        return tx.customer.create({
          data: {
            id: input.id,
            customerCode,
            name,
            phonePrimary,
            phoneSecondary: phoneSecondary ?? null,
            address: address ?? null,
            createdById: input.createdById,
          },
          select: { id: true, customerCode: true },
        });
      });
      return { ok: true, id: customer.id, customerCode: customer.customerCode, alreadyExisted: false };
    } catch (err) {
      if (isUniqueConstraintError(err) && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }
  // Unreachable (the loop above always either returns or throws) — kept
  // only so TypeScript sees every path return a value.
  throw new Error("applyCustomerCreateSync: exhausted retry attempts");
}

export type CustomerUpdateSyncResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "conflict"; serverUpdatedAt: string }
  | { ok: false; reason: "invalid-input"; message: string };

/**
 * Local-first customer update with a simple, safe version guard (Phase 5
 * §H / the approved Phase 1 architecture's Customer conflict strategy:
 * last-write-wins WITH a check, never a blind overwrite). `baseUpdatedAt`
 * is the server `updatedAt` value the client's local edit was made
 * against.
 *
 * Distinguishes two different reasons `existing.updatedAt` might not
 * match `baseUpdatedAt`:
 *   - The submitted values are IDENTICAL to what's already stored -> this
 *     is a retried request for an update that already applied (e.g. the
 *     first attempt's response never reached the client) — safe,
 *     idempotent success, not a conflict.
 *   - The submitted values differ from what's already stored -> something
 *     else genuinely changed this customer in the meantime — a real
 *     conflict, reported clearly, never silently overwritten.
 */
export async function applyCustomerUpdateSync(input: {
  customerId: string;
  name: unknown;
  phonePrimary: unknown;
  phoneSecondary: unknown;
  address: unknown;
  baseUpdatedAt: string;
}): Promise<CustomerUpdateSyncResult> {
  const parsed = customerInputSchema.safeParse({
    name: input.name,
    phonePrimary: input.phonePrimary,
    phoneSecondary: input.phoneSecondary || undefined,
    address: input.address || undefined,
  });
  if (!parsed.success) {
    return { ok: false, reason: "invalid-input", message: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }
  const { name, phonePrimary, phoneSecondary, address } = parsed.data;

  const existing = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!existing || existing.deletedAt) {
    return { ok: false, reason: "not-found" };
  }

  const targetPhoneSecondary = phoneSecondary ?? null;
  const targetAddress = address ?? null;
  const alreadyMatches =
    existing.name === name &&
    existing.phonePrimary === phonePrimary &&
    existing.phoneSecondary === targetPhoneSecondary &&
    existing.address === targetAddress;

  if (existing.updatedAt.toISOString() !== input.baseUpdatedAt) {
    if (alreadyMatches) {
      return { ok: true, updatedAt: existing.updatedAt.toISOString() };
    }
    return { ok: false, reason: "conflict", serverUpdatedAt: existing.updatedAt.toISOString() };
  }

  if (alreadyMatches) {
    // Nothing actually changed — a safe no-op, not worth a write.
    return { ok: true, updatedAt: existing.updatedAt.toISOString() };
  }

  const updated = await prisma.customer.update({
    where: { id: input.customerId },
    data: { name, phonePrimary, phoneSecondary: targetPhoneSecondary, address: targetAddress },
  });

  return { ok: true, updatedAt: updated.updatedAt.toISOString() };
}
