"use server";

// Server Actions for Customer CRUD (Step 3).
//
// customerCode ("SD-000001", ...) is never accepted as user input — it is
// always generated here, inside the same transaction as the insert, and is
// never part of the update payload. Deletion is always a soft delete
// (deletedAt set) so a customerCode is never reused, and Measurement/Order
// rows referencing the customer are left untouched.

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { parseCustomerInput } from "@/lib/customer-validation";
import { deleteOrderCascade } from "@/lib/order-delete";

// parseCustomerInput (and the validation rule itself) now lives in its
// own plain module, customer-validation.ts (Step 25) — a "use server"
// file's exports must all be async Server Actions, and the combined
// new-customer+order action needs to share this validator without
// duplicating it. Re-imported here under its original name so nothing
// below this line changed.

/**
 * Generates the next customerCode ("SD-000001", "SD-000002", ...).
 *
 * Looks at the highest existing code across ALL customers — including
 * soft-deleted ones, since a deleted customer's code must stay reserved
 * forever — and increments it. Must be called inside the same transaction
 * as the insert that consumes the code (see createCustomer) so the
 * read-then-write is as tight as possible.
 */
// Exported (Step 25) so the combined new-customer+order action can
// generate a customerCode inside the same transaction it also creates
// the Order graph in — the read-then-increment rule itself is unchanged.
export async function generateCustomerCode(tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.customer.findFirst({
    orderBy: { customerCode: "desc" },
    select: { customerCode: true },
  });

  const lastNumber = last ? parseInt(last.customerCode.slice(3), 10) : 0;
  const nextNumber = lastNumber + 1;
  return `SD-${String(nextNumber).padStart(6, "0")}`;
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function createCustomer(formData: FormData): Promise<void> {
  const session = await requireSession();

  const parsed = parseCustomerInput(formData);
  if (!parsed.success) {
    redirect(`/customers/new?error=${encodeURIComponent(parsed.error)}`);
  }

  const { name, phonePrimary, phoneSecondary, address } = parsed.data;

  // Phase 1 has a single admin and low write concurrency, but codes must
  // never collide or be skipped-and-reused, so retry a handful of times on
  // the rare race where two creates read the same "last code" at once.
  const MAX_ATTEMPTS = 5;
  let customerId: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const customer = await prisma.$transaction(async (tx) => {
        const customerCode = await generateCustomerCode(tx);
        return tx.customer.create({
          data: {
            customerCode,
            name,
            phonePrimary,
            phoneSecondary: phoneSecondary ?? null,
            address: address ?? null,
            createdById: session.sub,
          },
          select: { id: true },
        });
      });
      customerId = customer.id;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err) && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }

  redirect(`/customers/${customerId}`);
}

export async function updateCustomer(customerId: string, formData: FormData): Promise<void> {
  await requireSession();

  const parsed = parseCustomerInput(formData);
  if (!parsed.success) {
    redirect(`/customers/${customerId}/edit?error=${encodeURIComponent(parsed.error)}`);
  }

  const existing = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!existing || existing.deletedAt) {
    // Step 31: the customer this edit targeted no longer exists (or was
    // already soft-deleted) — there's no specific page left to send the
    // admin back into, so this falls back to S1 Search/Home, not the
    // legacy /customers list, which is no longer part of the required
    // navigation flow.
    redirect("/dashboard");
  }

  const { name, phonePrimary, phoneSecondary, address } = parsed.data;

  // customerCode, createdAt, and every id are never part of this payload —
  // there is no code path here that can touch them.
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      name,
      phonePrimary,
      phoneSecondary: phoneSecondary ?? null,
      address: address ?? null,
    },
  });

  redirect(`/customers/${customerId}`);
}

export async function deleteCustomer(customerId: string): Promise<void> {
  await requireSession();

  const existing = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!existing || existing.deletedAt) {
    // Step 31: already gone — same "back to Search/Home" fallback as
    // updateCustomer above, and for the same reason.
    redirect("/dashboard");
  }

  // Step 55 — Part 3: the customer row itself is still only ever soft-
  // deleted (its id, customerCode, and Measurement stay in place, same
  // as before — customerCode must never be reused, and the row still
  // existing is what lets it keep showing the existing "This customer
  // has been deleted" notice rather than 404ing). What changed is that
  // this no longer leaves every one of their Orders (and OrderItems/
  // MeasurementSnapshots) sitting untouched in Postgres — that was the
  // confirmed root cause of a deleted customer's orders staying fully
  // visible in Order Board/Recent Orders/dashboard counts (nothing
  // anywhere filters those queries on customer.deletedAt). Fixed by
  // actually removing the orders, reusing deleteOrderCascade
  // (order-delete.ts) — the exact same per-order deletion Part 2's
  // standalone Delete Order feature uses, so there is only one
  // definition of "what deleting an order means" in this codebase, and
  // by construction it can never delete an unrelated customer's orders
  // (each id comes straight from this customer's own `orders` relation).
  // One transaction: either every order is gone AND the customer is
  // marked deleted, or (on any failure) none of it applied.
  await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where: { customerId }, select: { id: true } });
    for (const order of orders) {
      await deleteOrderCascade(tx, order.id);
    }
    await tx.customer.update({
      where: { id: customerId },
      data: { deletedAt: new Date() },
    });
  });

  // Step 31: deleting a customer used to land on the legacy /customers
  // list — that screen is no longer part of the required navigation flow
  // (Step 27/30 audits), and the customer that was just deleted no longer
  // has a profile page to return to either. S1 Search/Home is the correct
  // destination: the deleted customer is already excluded from its
  // results (search filters on deletedAt: null), so this also visibly
  // confirms the deletion took effect.
  redirect("/dashboard");
}
