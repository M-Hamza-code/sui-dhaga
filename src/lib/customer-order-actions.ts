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
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { parseCustomerInput } from "@/lib/customer-validation";
import { generateCustomerCode } from "@/lib/customer-actions";
import { validateOrderInput, generateOrderNumber } from "@/lib/order-actions";
import { buildOrderCreateData } from "@/lib/order-build";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { printPreviewUrl } from "@/lib/order-navigation";

const NEW_CUSTOMER_ORDER_URL = "/customers/new/order";

export async function createCustomerAndOrder(formData: FormData): Promise<void> {
  const session = await requireSession();

  const customerResult = parseCustomerInput(formData);
  if (!customerResult.success) {
    redirect(`${NEW_CUSTOMER_ORDER_URL}?error=${encodeURIComponent(customerResult.error)}`);
  }

  const orderResult = await validateOrderInput(formData);
  if ("error" in orderResult) {
    redirect(`${NEW_CUSTOMER_ORDER_URL}?error=${encodeURIComponent(orderResult.error)}`);
  }

  const { name, phonePrimary, phoneSecondary, address } = customerResult.data;
  const validatedOrder = orderResult.data;

  const MAX_ATTEMPTS = 5;
  let customerId: string | undefined;
  let orderId: string | undefined;

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
          select: { id: true },
        });

        const orderNumber = await generateOrderNumber(tx);
        const order = await tx.order.create({
          data: buildOrderCreateData(customer.id, orderNumber, session.sub, validatedOrder),
          select: { id: true },
        });

        return { customerId: customer.id, orderId: order.id };
      });
      customerId = result.customerId;
      orderId = result.orderId;
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

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);

  // Step 29: same shared post-save destination as createOrder — see
  // order-navigation.ts. This action still doesn't invent a second
  // version of the sendOnWhatsApp logic; it reuses the exact same helper.
  const sendOnWhatsApp = formData.get("sendOnWhatsApp") === "on";
  // Non-null: the retry loop above either broke with both ids assigned or
  // already threw — same guarantee the previous template-literal redirect
  // relied on implicitly.
  redirect(printPreviewUrl(customerId!, orderId!, sendOnWhatsApp));
}
