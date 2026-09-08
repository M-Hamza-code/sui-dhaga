"use server";

// Server Actions for Orders (Step 6, rebuilt in Step 14).
//
// Step 14 closes the gap Steps 9 and 11 both flagged: createOrder now
// actually populates the multi-suit / measurement-snapshot graph the
// schema has supported since Step 9 (Order.defaultMeasurementSnapshot,
// Order.items[], OrderItem.measurementSnapshot override) instead of
// writing a bare Order row. The whole graph — Order, its default
// MeasurementSnapshot, every OrderItem, and any per-suit override
// MeasurementSnapshot — is created in ONE nested Prisma write inside the
// existing orderNumber retry-transaction, so it is all-or-nothing: either
// every row exists or none of them do.
//
// orderNumber ("ORD-000001", ...) is generated the same way customerCode
// is in customer-actions.ts: read the highest existing number inside a
// transaction, increment, retry on the rare unique-constraint race. It is
// never accepted from the client — same for status, balanceAmount, and
// every MeasurementSnapshot value, which are always server-computed or
// server-validated, never trusted as submitted.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, DesignOptionCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { MONEY_REGEX, isAdvanceWithinTotal, calculateBalance } from "@/lib/money";
import { measurementValueSchema, toMeasurementValueData, type MeasurementValueInput } from "@/lib/measurement-value";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { buildOrderCreateData, type ValidatedOrderInput } from "@/lib/order-build";
import { printPreviewUrl } from "@/lib/order-navigation";
import { applyOrderStatusUpdate } from "@/lib/order-status-update";

// isUniqueConstraintError and buildOrderCreateData/ValidatedOrderInput
// now live in their own plain (non-"use server") modules (Step 25) — a
// "use server" file's exports must all be async Server Actions, and
// customer-order-actions.ts needs to share both without duplicating
// them. Re-imported here under their original names so nothing below
// this line changed.

// One physical order pad line item can reasonably run to a handful of
// suits; this is a sanity ceiling against a malformed/abusive submission,
// not a real business limit the owner would ever approach.
const MAX_SUITS_PER_ORDER = 20;

const orderInputSchema = z.object({
  orderDate: z.string().trim().min(1, "Order Date is required"),
  deliveryDate: z.string().trim().optional(),
  suitType: z.enum(["SIMPLE", "GARAM_SILAI", "DESIGNING", "DOUBLE_STITCH", "BARABAR_SILAI"], {
    errorMap: () => ({ message: "Select a Suit Type" }),
  }),
  collarType: z.enum(["POINT", "FRENCH", "TIE"], { errorMap: () => ({ message: "Select a Collar" }) }),
  bainType: z.enum(["FULL_BAIN", "HALF_GOL_BAIN", "CUT_BAIN"], { errorMap: () => ({ message: "Select a Bain" }) }),
  cuffType: z.enum(["NOK_DAR", "CUT", "GOL", "FOLD"], { errorMap: () => ({ message: "Select a Cuff" }) }),
  gheraType: z.enum(["GOL", "SEEDHA"], { errorMap: () => ({ message: "Select a Ghera Style" }) }),
  // Optional: the DesignOption FK is nullable in the schema. Patti/Placket
  // has no home in the design brief's style block (§6b) — it is no longer
  // collected on this form. Its column and historical data are untouched;
  // new orders simply never set it.
  pocketOptionId: z.string().trim().optional(),
  totalAmount: z.string().trim().regex(MONEY_REGEX, "Total Amount must be a valid non-negative number"),
  advanceAmount: z.string().trim().regex(MONEY_REGEX, "Advance Amount must be a valid non-negative number"),
  note: z.string().trim().max(1000, "Note is too long").optional(),
});

export async function generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.order.findFirst({
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  const lastNumber = last ? parseInt(last.orderNumber.slice(4), 10) : 0;
  const nextNumber = lastNumber + 1;
  return `ORD-${String(nextNumber).padStart(6, "0")}`;
}

/** Confirms a DesignOption id is real, active, and in the expected category. */
async function validateDesignOption(
  id: string | undefined,
  category: DesignOptionCategory,
  label: string
): Promise<string | null> {
  if (!id) return null; // not selected — allowed, the FK is nullable
  const option = await prisma.designOption.findUnique({ where: { id } });
  if (!option || option.category !== category || !option.isActive) {
    return `Selected ${label} option is not valid.`;
  }
  return null;
}

function parseQuantity(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = parseInt(raw.trim(), 10);
  if (n < 1 || n > MAX_SUITS_PER_ORDER) return null;
  return n;
}

/** Reads the 10 decimal fields + shalwarPocket for one measurement block ("default" or "item.N") from FormData. */
function readMeasurementBlock(formData: FormData, prefix: string) {
  return measurementValueSchema.safeParse({
    length: formData.get(`${prefix}.length`) || undefined,
    shoulder: formData.get(`${prefix}.shoulder`) || undefined,
    sleeve: formData.get(`${prefix}.sleeve`) || undefined,
    neck: formData.get(`${prefix}.neck`) || undefined,
    chest: formData.get(`${prefix}.chest`) || undefined,
    waist: formData.get(`${prefix}.waist`) || undefined,
    hem: formData.get(`${prefix}.hem`) || undefined,
    shalwarLength: formData.get(`${prefix}.shalwarLength`) || undefined,
    pancha: formData.get(`${prefix}.pancha`) || undefined,
    shalwarGheraReady: formData.get(`${prefix}.shalwarGheraReady`) || undefined,
    shalwarPocket: formData.get(`${prefix}.shalwarPocket`) || "",
  });
}

/** True only if at least one measurement value was actually entered — an all-empty block is not "measured". */
function isMeasurementBlockEmpty(data: MeasurementValueInput): boolean {
  return (
    !data.length &&
    !data.shoulder &&
    !data.sleeve &&
    !data.neck &&
    !data.chest &&
    !data.waist &&
    !data.hem &&
    !data.shalwarLength &&
    !data.pancha &&
    !data.shalwarGheraReady &&
    data.shalwarPocket === ""
  );
}

/**
 * Every validation createOrder always performed — zod parsing of the
 * style/date/money fields, the +7-day delivery default, the
 * advance<=total check, DesignOption existence/category/active checks,
 * and per-suit measurement parsing (identical rules, same error text) —
 * extracted (Step 25) so it can be reused by both an existing customer's
 * order (createOrder, below) and the combined new-customer+order action
 * (customer-order-actions.ts), with neither duplicating this logic.
 *
 * Deliberately never touches customerId or writes to the database (only
 * the read-only DesignOption lookup) — the caller knows which customer
 * this belongs to and owns its own error-redirect URL, since the two
 * callers redirect back to two different "new order" pages on failure.
 */
export async function validateOrderInput(formData: FormData): Promise<{ error: string } | { data: ValidatedOrderInput }> {
  const parsed = orderInputSchema.safeParse({
    orderDate: formData.get("orderDate") || "",
    deliveryDate: formData.get("deliveryDate") || undefined,
    suitType: formData.get("suitType"),
    collarType: formData.get("collarType"),
    bainType: formData.get("bainType"),
    cuffType: formData.get("cuffType"),
    gheraType: formData.get("gheraType"),
    pocketOptionId: formData.get("pocketOptionId") || undefined,
    totalAmount: formData.get("totalAmount") || "",
    advanceAmount: formData.get("advanceAmount") || "",
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }

  const data = parsed.data;

  const quantity = parseQuantity(formData.get("quantity"));
  if (quantity === null) {
    return { error: `Number of suits must be a whole number from 1 to ${MAX_SUITS_PER_ORDER}` };
  }

  const orderDate = new Date(data.orderDate);
  if (Number.isNaN(orderDate.getTime())) {
    return { error: "Order Date must be a valid date" };
  }

  // Defaults to +7 days when not supplied (design brief §6c) — computed
  // server-side too, never trusting a blank/omitted client field to mean
  // "no delivery date" by accident.
  let deliveryDate: Date;
  if (data.deliveryDate) {
    deliveryDate = new Date(data.deliveryDate);
    if (Number.isNaN(deliveryDate.getTime())) {
      return { error: "Delivery Date must be a valid date" };
    }
  } else {
    deliveryDate = new Date(orderDate);
    deliveryDate.setDate(deliveryDate.getDate() + 7);
  }
  if (deliveryDate < orderDate) {
    return { error: "Delivery Date cannot be earlier than Order Date" };
  }

  if (!isAdvanceWithinTotal(data.totalAmount, data.advanceAmount)) {
    return { error: "Advance Amount cannot exceed Total Amount" };
  }

  const pocketError = await validateDesignOption(data.pocketOptionId, DesignOptionCategory.POCKET, "Pocket");
  if (pocketError) {
    return { error: pocketError };
  }

  // Default measurement snapshot — what the owner actually entered/kept
  // for this order, not a link back to the live Measurement row (Step 9
  // architecture: a snapshot is an independent, frozen copy).
  const defaultParsed = readMeasurementBlock(formData, "default");
  if (!defaultParsed.success) {
    return { error: defaultParsed.error.issues.map((issue) => issue.message).join(" ") };
  }
  const defaultNoteRaw = formData.get("default.note");
  const defaultNote = typeof defaultNoteRaw === "string" && defaultNoteRaw.trim() !== "" ? defaultNoteRaw.trim() : null;

  // Per-suit overrides: only for positions where the "different
  // measurements for this suit" toggle was actually on. Every other
  // position gets measurementSnapshotId: null and inherits the default via
  // the order detail page's own fallback logic — never a duplicated copy.
  const itemOverrides: (ReturnType<typeof toMeasurementValueData> | null)[] = [];
  for (let position = 1; position <= quantity; position++) {
    const overrideOn = formData.get(`item.${position}.override`) === "on";
    if (!overrideOn) {
      itemOverrides.push(null);
      continue;
    }
    const itemParsed = readMeasurementBlock(formData, `item.${position}`);
    if (!itemParsed.success) {
      return { error: `Suit ${position}: ${itemParsed.error.issues.map((issue) => issue.message).join(" ")}` };
    }
    // An override toggle left on with nothing actually entered behaves
    // exactly as if it were off — no empty override snapshot is created.
    if (isMeasurementBlockEmpty(itemParsed.data)) {
      itemOverrides.push(null);
    } else {
      itemOverrides.push(toMeasurementValueData(itemParsed.data));
    }
  }

  // Never trust a client-supplied balance — always recalculated here.
  const balanceAmount = calculateBalance(data.totalAmount, data.advanceAmount);
  const defaultSnapshotData = { ...toMeasurementValueData(defaultParsed.data), note: defaultNote, isBackfilled: false };

  return {
    data: {
      orderDate,
      deliveryDate,
      suitType: data.suitType,
      collarType: data.collarType,
      bainType: data.bainType,
      cuffType: data.cuffType,
      gheraType: data.gheraType,
      pocketOptionId: data.pocketOptionId,
      totalAmount: data.totalAmount,
      advanceAmount: data.advanceAmount,
      balanceAmount,
      note: data.note ?? null,
      quantity,
      defaultSnapshotData,
      itemOverrides,
    },
  };
}

export async function createOrder(customerId: string, formData: FormData): Promise<void> {
  const session = await requireSession();

  // Soft-deleted customers cannot get new orders — same rule Step 3/5
  // already apply to editing the customer and adding a measurement.
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    // Step 31: no specific page left to return to — back to S1
    // Search/Home, not the legacy /customers list.
    redirect("/dashboard");
  }

  const newOrderUrl = `/customers/${customerId}/orders/new`;

  const result = await validateOrderInput(formData);
  if ("error" in result) {
    redirect(`${newOrderUrl}?error=${encodeURIComponent(result.error)}`);
  }
  const validated = result.data;

  const MAX_ATTEMPTS = 5;
  let orderId: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const order = await prisma.$transaction(async (tx) => {
        const orderNumber = await generateOrderNumber(tx);
        // A single nested create writes the Order, its default
        // MeasurementSnapshot, every OrderItem, and any per-suit override
        // MeasurementSnapshot in one statement — all-or-nothing by
        // construction, not by manually wrapping several separate calls.
        return tx.order.create({
          data: buildOrderCreateData(customerId, orderNumber, session.sub, validated),
          select: { id: true },
        });
      });
      orderId = order.id;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err) && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }

  revalidatePath(`/customers/${customerId}`);

  // Step 24 added "Send on WhatsApp" as a pure post-save navigation choice
  // — nothing about it is persisted (no new column, nothing written to the
  // Order row above), and that's still true. Step 29 changed WHERE it
  // navigates to: every save now lands on S5 Print Preview, matching the
  // authoritative mockup's own S5 (which has no branch on how the order
  // was saved). The checkbox's value rides along as a query flag so S5 can
  // still visibly emphasize its "Send on WhatsApp" action when it was
  // checked — see order-navigation.ts and print-preview/page.tsx.
  const sendOnWhatsApp = formData.get("sendOnWhatsApp") === "on";
  // Non-null: the retry loop above either broke with both ids assigned or
  // already threw — same guarantee the previous template-literal redirect
  // relied on implicitly.
  redirect(printPreviewUrl(customerId!, orderId!, sendOnWhatsApp));
}

/**
 * Full 4-state status update (Step 14) — supersedes Step 6's
 * markOrderDelivered, which only ever supported the one-way
 * PENDING/NEW -> DELIVERED transition. That function is removed rather
 * than kept alongside this one: nothing else referenced it, and leaving
 * it in place would be a second, inconsistent way to change status.
 * PENDING is intentionally not offered as a selectable option (it is the
 * legacy pre-Step-9 label, never written by new code) but a still-PENDING
 * order can freely move to any of the four via this same action.
 *
 * `redirectTo` (Step 15) is where the browser lands after a successful
 * update — the order detail page's OrderStatusForm still defaults to that
 * same order's own detail page (unchanged behaviour), but the Order Board
 * binds it to the board's own URL (its active tab included) so changing a
 * status there refreshes the board in place instead of navigating away.
 * This is the same action either caller uses — not a second, competing
 * status-update path.
 *
 * Phase 4 (offline-first) — the actual guard/mutation logic below was
 * extracted into applyOrderStatusUpdate() (order-status-update.ts), which
 * the new offline-sync Route Handler now also calls, so the two paths can
 * never enforce different rules. This function's own observable
 * behavior — same guards, same redirects, same silent no-op on an
 * invalid/unchanged status, same revalidatePath calls — is unchanged.
 */
export async function updateOrderStatus(
  customerId: string,
  orderId: string,
  redirectTo: string,
  formData: FormData
): Promise<void> {
  await requireSession();

  const result = await applyOrderStatusUpdate(customerId, orderId, formData.get("status"));
  if (!result.ok) {
    if (result.reason === "customer-not-found") {
      // Step 31: no specific page left to return to — back to S1
      // Search/Home, not the legacy /customers list.
      redirect("/dashboard");
    }
    if (result.reason === "order-not-found") {
      // Unlike the guard above, this customer DOES still exist, so
      // returning to their own profile (not S1) is still the correct,
      // specific destination.
      redirect(`/customers/${customerId}`);
    }
    // reason === "invalid-status": same as always — silently ignored,
    // falls through to the normal revalidate + redirect below exactly
    // like an unrecognized/unchanged status value already did.
  }

  revalidatePath(`/customers/${customerId}/orders/${orderId}`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/orders");
  redirect(redirectTo);
}
