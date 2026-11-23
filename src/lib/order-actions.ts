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
import { coatMeasurementValueSchema, toCoatMeasurementValueData, type CoatMeasurementValueInput } from "@/lib/coat-measurement-value";
import { ALL_COAT_FIELD_KEYS } from "@/lib/coat-measurement-fields";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { buildOrderCreateData, type ValidatedOrderInput, type ItemStyleOverride } from "@/lib/order-build";
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

/**
 * Explicit per-entry Coat/Waistcoat garment selection schema (see
 * CoatGarmentSelection's own schema.prisma comment on why this exists
 * instead of inferring pricing from measurement content). Submitted as
 * `item.<position>.coatGarmentSelection` for every Coat-range position,
 * always a real value — never absent — but `.default("BOTH")` still
 * covers a malformed/tampered submission the same safe way every other
 * enum field in this schema already does.
 */
const coatGarmentSelectionSchema = z.enum(["PRINCE_COAT", "WAISTCOAT", "BOTH"]).default("BOTH");

// Step 63 — Collar and Bain are a single combined choice: exactly one of
// the two, never both, never neither — EXCEPT when there's no
// Kameez/Shalwar section on this order at all (kameezQuantity === 0, a
// Coat/Waistcoat-only order), which has no Suit & Styles section to
// submit either of them from, and that's correct, not an error. Checked
// as a plain post-parse condition (validateOrderInput, below) rather than
// a zod `.refine()`, since it needs kameezQuantity, which is parsed
// separately from the raw FormData (same reasoning the existing
// advance<=total check already follows for a cross-field rule).
const COLLAR_BAIN_ERROR = "Select either a Collar or a Bain (not both, and not neither)";
function exactlyOneOfCollarBain(collarType: string | undefined, bainType: string | undefined): boolean {
  return (collarType ? 1 : 0) + (bainType ? 1 : 0) === 1;
}

// Upgrade — Suit Type/Cuff/Ghera Style can now each be left "Not
// Specified" (same allowEmpty mechanism Collar already had), so all three
// are `.optional()` now rather than required — matching
// Order.suitType/cuffType/gheraType all being nullable columns. This is
// also what makes a Coat/Waistcoat-only order (no Suit & Styles section
// submitted at all) validate cleanly instead of always failing.
const orderInputSchema = z.object({
  orderDate: z.string().trim().min(1, "Order Date is required"),
  deliveryDate: z.string().trim().optional(),
  // Independent Kameez/Shalwar + Coat/Waistcoat order sections upgrade —
  // Order.measurementMode is no longer a real admin-facing choice (the
  // mode-selector UI is gone; an order can contain both garment types at
  // once), so this is never actually submitted by the current form
  // anymore — it stays `.default("KAMEEZ_SHALWAR")` purely so an older
  // client or a replayed pre-upgrade sync queue item that still sends it
  // keeps parsing exactly as before.
  measurementMode: z.enum(["KAMEEZ_SHALWAR", "COAT"]).default("KAMEEZ_SHALWAR"),
  suitType: z.enum(["SIMPLE", "GARAM_SILAI", "DESIGNING", "DOUBLE_STITCH", "BARABAR_SILAI"]).optional(),
  collarType: z.enum(["POINT", "FRENCH", "TIE"]).optional(),
  bainType: z.enum(["FULL_BAIN", "HALF_GOL_BAIN", "CUT_BAIN"]).optional(),
  cuffType: z.enum(["NOK_DAR", "CUT", "GOL", "FOLD"]).optional(),
  gheraType: z.enum(["GOL", "SEEDHA"]).optional(),
  // Optional: the DesignOption FK is nullable in the schema.
  pocketOptionId: z.string().trim().optional(),
  // Step 57 — Patti Style is now collected on the form too, same
  // optional-DesignOption-FK shape as Pocket above.
  pattiOptionId: z.string().trim().optional(),
  // Pancha Style — same optional-DesignOption-FK shape, order-level only.
  panchaOptionId: z.string().trim().optional(),
  totalAmount: z.string().trim().regex(MONEY_REGEX, "Total Amount must be a valid non-negative number"),
  advanceAmount: z.string().trim().regex(MONEY_REGEX, "Advance Amount must be a valid non-negative number"),
  // Independent Coat/Waistcoat pricing — the actual per-unit price used
  // for this order, frozen at save time (see Order.princeCoatUnitPrice's
  // own schema.prisma comment on why). Both optional: absent/blank
  // whenever coatQuantity is 0, since there's nothing to price.
  princeCoatUnitPrice: z.string().trim().regex(MONEY_REGEX, "Prince Coat price must be a valid non-negative number").optional(),
  waistcoatUnitPrice: z.string().trim().regex(MONEY_REGEX, "Waistcoat price must be a valid non-negative number").optional(),
  note: z.string().trim().max(1000, "Note is too long").optional(),
});

// Step 50 — one Kameez/Shalwar suit's (position 2+) explicit style. Same
// enum rules as orderInputSchema's own style fields above; kept as a
// separate schema rather than reused wholesale because this one has no
// date/money/note fields at all — only the style values a per-suit
// override can set. This schema is only ever parsed for a position
// within the Kameez range that actually submitted style fields (see
// validateOrderInput's own gate below) — a Coat entry never submits them
// at all, so this schema's own collar/bain check is always the plain
// "exactly one" rule, never the Coat-only exception above.
const itemStyleSchema = z.object({
  suitType: z.enum(["SIMPLE", "GARAM_SILAI", "DESIGNING", "DOUBLE_STITCH", "BARABAR_SILAI"]).optional(),
  collarType: z.enum(["POINT", "FRENCH", "TIE"]).optional(),
  bainType: z.enum(["FULL_BAIN", "HALF_GOL_BAIN", "CUT_BAIN"]).optional(),
  cuffType: z.enum(["NOK_DAR", "CUT", "GOL", "FOLD"]).optional(),
  gheraType: z.enum(["GOL", "SEEDHA"]).optional(),
  pocketOptionId: z.string().trim().optional(),
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

/**
 * Independent Kameez/Shalwar + Coat/Waistcoat sections upgrade — each
 * section has its own count, 0-20 (0 meaning "not ordering this garment
 * type at all" — required so "Coat/Waistcoat only" and "Kameez/Shalwar
 * only" are both genuinely representable, not just "at least 1"). The
 * combined total across both sections still can't exceed
 * MAX_SUITS_PER_ORDER*2 positions — enforced by each section's own 0-20
 * range independently, no separate combined check needed.
 */
function parseGarmentQuantity(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = parseInt(raw.trim(), 10);
  if (n < 0 || n > MAX_SUITS_PER_ORDER) return null;
  return n;
}

/** Reads the 10 decimal fields + shalwarPocket for one measurement block ("default" or "item.N") from FormData. */
function readMeasurementBlock(formData: FormData, prefix: string) {
  return measurementValueSchema.safeParse({
    length: formData.get(`${prefix}.length`) || undefined,
    shoulder: formData.get(`${prefix}.shoulder`) || undefined,
    sleeve: formData.get(`${prefix}.sleeve`) || undefined,
    armHole: formData.get(`${prefix}.armHole`) || undefined,
    kohni: formData.get(`${prefix}.kohni`) || undefined,
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
    !data.armHole &&
    !data.kohni &&
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

/** Reads the 21 Prince Coat/Waistcoat decimal fields for one measurement block ("default" or "item.N") from FormData — mirrors readMeasurementBlock above. */
function readCoatMeasurementBlock(formData: FormData, prefix: string) {
  const raw: Record<string, FormDataEntryValue | undefined> = {};
  for (const key of ALL_COAT_FIELD_KEYS) {
    raw[key] = formData.get(`${prefix}.${key}`) || undefined;
  }
  return coatMeasurementValueSchema.safeParse(raw);
}

/** True only if at least one Coat/Waistcoat value was actually entered — mirrors isMeasurementBlockEmpty above. */
function isCoatMeasurementBlockEmpty(data: CoatMeasurementValueInput): boolean {
  return ALL_COAT_FIELD_KEYS.every((key) => !(data as Record<string, string | undefined>)[key]);
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
    measurementMode: formData.get("measurementMode") || undefined,
    // Step 63 — "" (TileGroup's hidden input is always present, even
    // when nothing is selected) must become undefined before zod's
    // .optional() sees it, same treatment pocketOptionId/pattiOptionId
    // already get below. Now also true of suitType/cuffType/gheraType
    // (Not Specified) and, always, for a Coat-mode order which submits
    // none of the five Suit & Styles fields at all.
    suitType: formData.get("suitType") || undefined,
    collarType: formData.get("collarType") || undefined,
    bainType: formData.get("bainType") || undefined,
    cuffType: formData.get("cuffType") || undefined,
    gheraType: formData.get("gheraType") || undefined,
    pocketOptionId: formData.get("pocketOptionId") || undefined,
    pattiOptionId: formData.get("pattiOptionId") || undefined,
    panchaOptionId: formData.get("panchaOptionId") || undefined,
    totalAmount: formData.get("totalAmount") || "",
    advanceAmount: formData.get("advanceAmount") || "",
    princeCoatUnitPrice: formData.get("princeCoatUnitPrice") || undefined,
    waistcoatUnitPrice: formData.get("waistcoatUnitPrice") || undefined,
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }

  const data = parsed.data;

  // Three-tab Order Type redesign — THREE separate counts, each 0-20
  // (0 = "not ordering this garment type"), submitted by the form as
  // three separate fields (kameezQuantity/princeCoatQuantity/
  // waistcoatQuantity — no more single combined "coatQuantity" field).
  // Position ranges: Kameez occupies 1..kameezQuantity, Prince Coat
  // occupies the next princeCoatQuantity positions, Waistcoat occupies
  // the remainder — every position beyond kameezQuantity is still
  // uniformly "COAT" measurementMode (see itemMeasurementModes below);
  // which specific garment each one is for comes from its own
  // item.<n>.coatGarmentSelection field (now always PRINCE_COAT or
  // WAISTCOAT, set by the form per range — see order-form.tsx's own
  // comment — never BOTH for anything newly submitted; BOTH only still
  // appears when re-saving an untouched legacy item from before this
  // redesign). At least one of the three sections must actually be used.
  const kameezQuantity = parseGarmentQuantity(formData.get("kameezQuantity"));
  if (kameezQuantity === null) {
    return { error: `Number of suits must be a whole number from 0 to ${MAX_SUITS_PER_ORDER}` };
  }
  const princeCoatQuantity = parseGarmentQuantity(formData.get("princeCoatQuantity"));
  if (princeCoatQuantity === null) {
    return { error: `Number of Prince Coats must be a whole number from 0 to ${MAX_SUITS_PER_ORDER}` };
  }
  const waistcoatQuantity = parseGarmentQuantity(formData.get("waistcoatQuantity"));
  if (waistcoatQuantity === null) {
    return { error: `Number of Waistcoats must be a whole number from 0 to ${MAX_SUITS_PER_ORDER}` };
  }
  const coatQuantity = princeCoatQuantity + waistcoatQuantity;
  if (kameezQuantity === 0 && coatQuantity === 0) {
    return { error: "Add at least one Kameez/Shalwar suit, Prince Coat, or Waistcoat entry." };
  }
  const quantity = kameezQuantity + coatQuantity;

  // Collar/Bain's "exactly one" rule only applies when there's actually a
  // Kameez/Shalwar section to apply it to — a Coat/Waistcoat-only order
  // (kameezQuantity === 0) has no Suit & Styles section at all, so
  // neither being set is correct, not an error.
  if (kameezQuantity > 0 && !exactlyOneOfCollarBain(data.collarType, data.bainType)) {
    return { error: COLLAR_BAIN_ERROR };
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

  const pattiError = await validateDesignOption(data.pattiOptionId, DesignOptionCategory.PATTI, "Patti Style");
  if (pattiError) {
    return { error: pattiError };
  }

  const panchaError = await validateDesignOption(data.panchaOptionId, DesignOptionCategory.PANCHA, "Pancha Style");
  if (panchaError) {
    return { error: panchaError };
  }

  // Default measurement snapshot — what the owner actually entered/kept
  // for this order, not a link back to the live Measurement row (Step 9
  // architecture: a snapshot is an independent, frozen copy). Both the
  // Kameez/Shalwar reader AND the Coat/Waistcoat reader are always run,
  // regardless of measurementMode — the UI only ever renders/submits
  // fields for the active mode, so the inactive set's fields are simply
  // absent from FormData and parse to all-null, at no cost. This is what
  // lets ONE snapshot row hold either group (see MeasurementSnapshot's own
  // schema.prisma comment) without any mode-based branching here.
  const defaultParsed = readMeasurementBlock(formData, "default");
  if (!defaultParsed.success) {
    return { error: defaultParsed.error.issues.map((issue) => issue.message).join(" ") };
  }
  const defaultCoatParsed = readCoatMeasurementBlock(formData, "default");
  if (!defaultCoatParsed.success) {
    return { error: defaultCoatParsed.error.issues.map((issue) => issue.message).join(" ") };
  }
  const defaultNoteRaw = formData.get("default.note");
  const defaultNote = typeof defaultNoteRaw === "string" && defaultNoteRaw.trim() !== "" ? defaultNoteRaw.trim() : null;

  // Per-suit overrides: only for positions where the "different
  // measurements for this suit" toggle was actually on. Every other
  // position gets measurementSnapshotId: null and inherits the default via
  // the order detail page's own fallback logic — never a duplicated copy.
  const itemOverrides: ((ReturnType<typeof toMeasurementValueData> & ReturnType<typeof toCoatMeasurementValueData>) | null)[] = [];
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
    const itemCoatParsed = readCoatMeasurementBlock(formData, `item.${position}`);
    if (!itemCoatParsed.success) {
      return { error: `Suit ${position}: ${itemCoatParsed.error.issues.map((issue) => issue.message).join(" ")}` };
    }
    // An override toggle left on with nothing actually entered (in either
    // group) behaves exactly as if it were off — no empty override
    // snapshot is created.
    if (isMeasurementBlockEmpty(itemParsed.data) && isCoatMeasurementBlockEmpty(itemCoatParsed.data)) {
      itemOverrides.push(null);
    } else {
      itemOverrides.push({ ...toMeasurementValueData(itemParsed.data), ...toCoatMeasurementValueData(itemCoatParsed.data) });
    }
  }

  // Step 50 — per-suit style, Kameez/Shalwar range only (positions
  // beyond kameezQuantity are Coat entries — see below — which never
  // have style fields at all). Position 1 always reads the order's own
  // style fields above (never its own override — see order-build.ts's
  // comment), so this loop only ever covers position 2 and beyond, and
  // only when there actually is more than one Kameez suit.
  //
  // Purely additive, like the measurement override above: a position
  // with NO item.N.suitType field submitted at all (not merely blank —
  // genuinely absent) is treated exactly as "no override", inheriting
  // the order's own style, no error. This is what keeps every caller
  // that predates this feature working completely unchanged — an older
  // client, a replayed offline-sync queue item recorded before this
  // deploy, or any other multi-suit submission that only ever knew about
  // per-suit MEASUREMENT overrides. Only a position where this field IS
  // present (the current order form always sends all five together — a
  // real attempt to set a per-suit style) is actually validated, so a
  // genuinely malformed value still gets rejected.
  const itemStyles: (ItemStyleOverride | null)[] = [null];
  for (let position = 2; position <= quantity; position++) {
    if (position > kameezQuantity || formData.get(`item.${position}.suitType`) === null) {
      itemStyles.push(null);
      continue;
    }
    const parsedStyle = itemStyleSchema.safeParse({
      suitType: formData.get(`item.${position}.suitType`),
      collarType: formData.get(`item.${position}.collarType`) || undefined,
      bainType: formData.get(`item.${position}.bainType`) || undefined,
      cuffType: formData.get(`item.${position}.cuffType`),
      gheraType: formData.get(`item.${position}.gheraType`),
      pocketOptionId: formData.get(`item.${position}.pocketOptionId`) || undefined,
    });
    if (!parsedStyle.success) {
      return { error: `Suit ${position}: ${parsedStyle.error.issues.map((issue) => issue.message).join(" ")}` };
    }
    // Always the plain "exactly one" rule here — a per-suit style
    // override is only ever parsed within the Kameez range, which always
    // has a real Suit & Styles section to submit it from.
    if (!exactlyOneOfCollarBain(parsedStyle.data.collarType, parsedStyle.data.bainType)) {
      return { error: `Suit ${position}: ${COLLAR_BAIN_ERROR}` };
    }
    const itemPocketError = await validateDesignOption(parsedStyle.data.pocketOptionId, DesignOptionCategory.POCKET, "Pocket");
    if (itemPocketError) {
      return { error: `Suit ${position}: ${itemPocketError}` };
    }
    itemStyles.push({
      ...parsedStyle.data,
      suitType: parsedStyle.data.suitType ?? null,
      collarType: parsedStyle.data.collarType ?? null,
      bainType: parsedStyle.data.bainType ?? null,
      cuffType: parsedStyle.data.cuffType ?? null,
      gheraType: parsedStyle.data.gheraType ?? null,
    });
  }

  // Independent sections upgrade — each position's garment type is now a
  // plain structural fact derived from which range it falls in (never a
  // client-submitted, admin-facing choice per suit — that per-suit
  // dropdown was the exact "Coat selectable inside a Kameez suit" problem
  // this upgrade removes). Positions 1..kameezQuantity are Kameez/Shalwar
  // (null = inherits Order.measurementMode, which is always
  // KAMEEZ_SHALWAR for every order going forward); positions beyond that
  // are Coat/Waistcoat, always explicitly "COAT".
  const itemMeasurementModes: (("KAMEEZ_SHALWAR" | "COAT") | null)[] = [];
  for (let position = 1; position <= quantity; position++) {
    itemMeasurementModes.push(position > kameezQuantity ? "COAT" : null);
  }

  // Explicit per-entry Coat/Waistcoat garment selection — admin-chosen,
  // NEVER derived from which measurement fields happen to have values
  // (see CoatGarmentSelection's own schema.prisma comment). Read for
  // every Coat-range position only; null for every Kameez/Shalwar
  // position, same shape as itemMeasurementModes above.
  const itemCoatGarmentSelections: (("PRINCE_COAT" | "WAISTCOAT" | "BOTH") | null)[] = [];
  for (let position = 1; position <= quantity; position++) {
    if (position <= kameezQuantity) {
      itemCoatGarmentSelections.push(null);
      continue;
    }
    const parsedSelection = coatGarmentSelectionSchema.safeParse(formData.get(`item.${position}.coatGarmentSelection`) || undefined);
    itemCoatGarmentSelections.push(parsedSelection.success ? parsedSelection.data : "BOTH");
  }

  // Never trust a client-supplied balance — always recalculated here.
  const balanceAmount = calculateBalance(data.totalAmount, data.advanceAmount);
  const defaultSnapshotData = {
    ...toMeasurementValueData(defaultParsed.data),
    ...toCoatMeasurementValueData(defaultCoatParsed.data),
    note: defaultNote,
    isBackfilled: false,
  };

  return {
    data: {
      orderDate,
      deliveryDate,
      measurementMode: data.measurementMode,
      suitType: data.suitType ?? null,
      collarType: data.collarType ?? null,
      bainType: data.bainType ?? null,
      cuffType: data.cuffType ?? null,
      gheraType: data.gheraType ?? null,
      pocketOptionId: data.pocketOptionId,
      pattiOptionId: data.pattiOptionId,
      panchaOptionId: data.panchaOptionId,
      totalAmount: data.totalAmount,
      advanceAmount: data.advanceAmount,
      balanceAmount,
      // Only meaningful when coatQuantity > 0 — null otherwise (a
      // Kameez-only order has no Coat/Waistcoat unit price to freeze).
      princeCoatUnitPrice: coatQuantity > 0 ? data.princeCoatUnitPrice ?? null : null,
      waistcoatUnitPrice: coatQuantity > 0 ? data.waistcoatUnitPrice ?? null : null,
      note: data.note ?? null,
      quantity,
      defaultSnapshotData,
      itemOverrides,
      itemMeasurementModes,
      itemCoatGarmentSelections,
      itemStyles,
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
