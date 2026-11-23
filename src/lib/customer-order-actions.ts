"use server";

// Combined new-customer + first-order Server Action (Step 25 — the
// authoritative fast flow: Dashboard → "New customer" → directly into
// the order form, blank customer block at the top, one submit creates
// both records).
//
// Deliberately reuses, rather than duplicates, everything that already
// exists and is already tested:
//   - customer validation: parseCustomerInput() (customer-validation.ts)
//     — the exact same rule createCustomer/updateCustomer already use.
//   - customerCode generation: generateCustomerCode() (customer-actions.ts).
//   - order validation + the Order/snapshot/OrderItem write shape:
//     validateOrderInput() (order-actions.ts) and buildOrderCreateData()
//     (order-build.ts) — unchanged from createOrder's own logic.
//   - orderNumber generation and the P2002 retry check: generateOrderNumber()
//     (order-actions.ts) and isUniqueConstraintError() (prisma-errors.ts).
//
// The one genuinely new piece is that both writes happen inside a
// SINGLE prisma.$transaction — not two separate ones — so a failure
// partway through (an order-number/customer-code collision on retry, or
// any other write error) can never leave an orphaned Customer row with
// no Order, or vice versa. Either both are created, or neither is.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseCustomerInput } from "@/lib/customer-validation";
import { generateCustomerCode } from "@/lib/customer-actions";
import { validateOrderInput, generateOrderNumber } from "@/lib/order-actions";
import { buildOrderCreateData } from "@/lib/order-build";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { printPreviewUrl } from "@/lib/order-navigation";

// Follow-up fix (regression) — this used to call redirect() for both the
// two validation-failure paths AND (in an earlier round) considered
// calling it on success too. Calling redirect() from a Server Action
// invoked as a plain client-side function call (not bound to a <form
// action>, which is what order-form.tsx now does — see its own comment)
// left the calling `await createCustomerAndOrder(formData)` resolving to
// `undefined` instead of propagating a navigation, which is exactly what
// produced the "Cannot read properties of undefined" crash. Removing
// every redirect() call from this action entirely — it now ALWAYS
// returns a plain, predictable, discriminated result object, success or
// failure — removes that ambiguity at its root rather than working
// around it. The client (order-form.tsx) is now the one place that
// decides what to do with either outcome, using its own existing
// setLocalError() display path for a failure — the exact same mechanism
// every other validation error in that component already uses.
export type CreateCustomerAndOrderResult =
  | {
      ok: true;
      customerId: string;
      customerCode: string;
      customerUpdatedAt: string;
      orderId: string;
      orderNumber: string;
      orderStatus: string;
      orderUpdatedAt: string;
      redirectUrl: string;
    }
  | { ok: false; error: string };

export async function createCustomerAndOrder(formData: FormData): Promise<CreateCustomerAndOrderResult> {
  // Second occurrence of the exact same regression class the two
  // validation branches already had fixed: requireSession() (auth.ts)
  // itself calls redirect("/login") when the session cookie is missing
  // or has become invalid (e.g. a long-open tab outliving a
  // SESSION_SECRET/SESSION_COOKIE_NAME rotation) — which, invoked from
  // this action's plain client-side call site, doesn't reliably
  // propagate as a navigation. The caller's `await` resolved to
  // `undefined`, and the new `if (!result.ok)` check this component now
  // runs immediately crashed on `undefined.ok` — invisible to the user
  // (an uncaught exception in an event handler, not something Next/React
  // display a message for), leaving the button stuck in "submitting"
  // forever and nothing saved. getSession() (the non-redirecting
  // sibling) plus an explicit, visible failure result closes this the
  // same way the validation paths already are — never silently doing
  // nothing.
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please refresh the page and log in again." };
  }

  const customerResult = parseCustomerInput(formData);
  if (!customerResult.success) {
    return { ok: false, error: customerResult.error };
  }

  const orderResult = await validateOrderInput(formData);
  if ("error" in orderResult) {
    return { ok: false, error: orderResult.error };
  }

  const { name, phonePrimary, phoneSecondary, address } = customerResult.data;
  const validatedOrder = orderResult.data;

  const MAX_ATTEMPTS = 5;
  let created:
    | {
        customerId: string;
        customerCode: string;
        customerUpdatedAt: Date;
        orderId: string;
        orderNumber: string;
        orderStatus: string;
        orderUpdatedAt: Date;
      }
    | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const customerCode = await generateCustomerCode(tx);
        const customer = await tx.customer.create({
          data: {
            customerCode,
            name,
            phonePrimary,
            phoneSecondary: phoneSecondary ?? null,
            address: address ?? null,
            createdById: session.sub,
          },
          select: { id: true, customerCode: true, updatedAt: true },
        });

        const orderNumber = await generateOrderNumber(tx);
        const order = await tx.order.create({
          data: buildOrderCreateData(customer.id, orderNumber, session.sub, validatedOrder),
          select: { id: true, orderNumber: true, status: true, updatedAt: true },
        });

        return {
          customerId: customer.id,
          customerCode: customer.customerCode,
          customerUpdatedAt: customer.updatedAt,
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderStatus: order.status,
          orderUpdatedAt: order.updatedAt,
        };
      });
      created = result;
      break;
    } catch (err) {
      // A P2002 here can come from either the customerCode or the
      // orderNumber uniqueness constraint — either way, the whole
      // transaction already rolled back (Prisma transactions are
      // all-or-nothing), so retrying regenerates BOTH codes fresh rather
      // than reusing a stale one.
      if (isUniqueConstraintError(err) && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }

  // Non-null: the retry loop above either broke with `created` assigned
  // or already threw.
  const { customerId, customerCode, customerUpdatedAt, orderId, orderNumber, orderStatus, orderUpdatedAt } = created!;

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);

  // Step 29: same shared post-save destination as createOrder — see
  // order-navigation.ts. This action still doesn't invent a second
  // version of the sendOnWhatsApp logic; it reuses the exact same helper.
  const sendOnWhatsApp = formData.get("sendOnWhatsApp") === "on";
  return {
    ok: true,
    customerId,
    customerCode,
    customerUpdatedAt: customerUpdatedAt.toISOString(),
    orderId,
    orderNumber,
    orderStatus,
    orderUpdatedAt: orderUpdatedAt.toISOString(),
    redirectUrl: printPreviewUrl(customerId, orderId, sendOnWhatsApp),
  };
}
