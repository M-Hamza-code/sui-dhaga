import { Prisma, OrderStatus, type SuitType, type CollarType, type BainType, type CuffType, type GheraType } from "@prisma/client";
import type { toMeasurementValueData } from "@/lib/measurement-value";

// Extracted (Step 25) into its own plain module — a "use server" file's
// exports must all be async Server Actions, and buildOrderCreateData is
// a pure, synchronous data builder both order-actions.ts's createOrder
// and the combined new-customer+order action (customer-order-actions.ts)
// need to share rather than duplicate.

/**
 * Step 50 — one suit's (position 2+) explicit style, when it was
 * configured differently from the order's own (= suit 1's) style. All
 * six fields are always set together — never a partial override — and a
 * position with no override at all is simply `null` in itemStyles below.
 */
export interface ItemStyleOverride {
  suitType: SuitType;
  collarType: CollarType;
  bainType: BainType;
  cuffType: CuffType;
  gheraType: GheraType;
  pocketOptionId?: string;
}

export interface ValidatedOrderInput {
  orderDate: Date;
  deliveryDate: Date;
  suitType: SuitType;
  collarType: CollarType;
  bainType: BainType;
  cuffType: CuffType;
  gheraType: GheraType;
  pocketOptionId?: string;
  /** Step 57 — order-level only, no per-suit override (OrderItem has no pattiOptionId column — see ItemStyleOverride's own comment). */
  pattiOptionId?: string;
  totalAmount: string;
  advanceAmount: string;
  balanceAmount: string;
  note: string | null;
  quantity: number;
  defaultSnapshotData: ReturnType<typeof toMeasurementValueData> & { note: string | null; isBackfilled: boolean };
  itemOverrides: (ReturnType<typeof toMeasurementValueData> | null)[];
  /** Step 50 — one entry per suit position, same length/order as itemOverrides; null = "same style as the order" (always true for position 1). */
  itemStyles: (ItemStyleOverride | null)[];
}

/**
 * Builds the nested Prisma write for one Order + its default snapshot +
 * every OrderItem + any per-suit override snapshot, connected to
 * `customerId` — exactly the same shape createOrder has always written.
 * Never touches the database itself; purely a data builder, so it can be
 * called with a customerId that was only just created moments earlier in
 * the same transaction (Step 25's combined new-customer+order action).
 */
export function buildOrderCreateData(
  customerId: string,
  orderNumber: string,
  sessionSub: string,
  validated: ValidatedOrderInput
): Prisma.OrderCreateInput {
  return {
    orderNumber,
    // Relation ("checked") syntax throughout — not raw scalar FK fields —
    // because mixing a raw customerId with the nested
    // defaultMeasurementSnapshot/items creates below forces Prisma's
    // "unchecked" input variant, which does not accept nested relation
    // writes for defaultMeasurementSnapshot at all.
    customer: { connect: { id: customerId } },
    orderDate: validated.orderDate,
    deliveryDate: validated.deliveryDate,
    suitType: validated.suitType,
    collarType: validated.collarType,
    bainType: validated.bainType,
    cuffType: validated.cuffType,
    gheraType: validated.gheraType,
    pocketOption: validated.pocketOptionId ? { connect: { id: validated.pocketOptionId } } : undefined,
    pattiOption: validated.pattiOptionId ? { connect: { id: validated.pattiOptionId } } : undefined,
    totalAmount: validated.totalAmount,
    advanceAmount: validated.advanceAmount,
    balanceAmount: validated.balanceAmount,
    status: OrderStatus.NEW,
    createdBy: { connect: { id: sessionSub } },
    note: validated.note,
    defaultMeasurementSnapshot: { create: validated.defaultSnapshotData },
    items: {
      create: validated.itemOverrides.map((override, index) => {
        const styleOverride = validated.itemStyles[index];
        return {
          position: index + 1,
          ...(override ? { measurementSnapshot: { create: { ...override, note: null, isBackfilled: false } } } : {}),
          ...(styleOverride
            ? {
                suitType: styleOverride.suitType,
                collarType: styleOverride.collarType,
                bainType: styleOverride.bainType,
                cuffType: styleOverride.cuffType,
                gheraType: styleOverride.gheraType,
                pocketOption: styleOverride.pocketOptionId ? { connect: { id: styleOverride.pocketOptionId } } : undefined,
              }
            : {}),
        };
      }),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Step 53 — Edit Order. Both functions below are purely additive: nothing
// above this line was changed, so buildOrderCreateData's own behavior
// (and every existing test/caller of it) is byte-for-byte unchanged.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The order-level scalar fields an edit can change — everything
 * buildOrderCreateData already writes on create EXCEPT orderDate (Step 53
 * keeps Order Date read-only; see order-form.tsx), customer/createdBy
 * (never reassigned by an edit), status (owned exclusively by the
 * existing OrderStatusForm/updateOrderStatus — an edit never touches it),
 * and orderNumber (never regenerated). defaultMeasurementSnapshot is
 * ALWAYS a fresh nested create, never a mutation of the order's existing
 * snapshot — MeasurementSnapshot rows are immutable once written (see
 * schema.prisma's own comment on the model); the previous snapshot simply
 * becomes unreferenced by this order, never touched or deleted, so
 * historical measurement data always remains intact.
 */
export function buildOrderUpdateData(validated: ValidatedOrderInput): Prisma.OrderUpdateInput {
  return {
    deliveryDate: validated.deliveryDate,
    suitType: validated.suitType,
    collarType: validated.collarType,
    bainType: validated.bainType,
    cuffType: validated.cuffType,
    gheraType: validated.gheraType,
    pocketOption: validated.pocketOptionId ? { connect: { id: validated.pocketOptionId } } : { disconnect: true },
    pattiOption: validated.pattiOptionId ? { connect: { id: validated.pattiOptionId } } : { disconnect: true },
    totalAmount: validated.totalAmount,
    advanceAmount: validated.advanceAmount,
    balanceAmount: validated.balanceAmount,
    note: validated.note,
    defaultMeasurementSnapshot: { create: validated.defaultSnapshotData },
  };
}

/**
 * One suit's measurement-override + style-override fields, shaped for a
 * brand-new OrderItem — the exact same shape buildOrderCreateData's own
 * items.create mapper already produces per position, factored out so a
 * newly-added suit during an edit (quantity increased) is built
 * identically rather than by a second, potentially-drifting copy.
 */
export function newOrderItemFields(
  override: ReturnType<typeof toMeasurementValueData> | null,
  styleOverride: ItemStyleOverride | null
): Prisma.OrderItemCreateWithoutOrderInput {
  return {
    position: 0, // caller always overwrites this with the real position
    ...(override ? { measurementSnapshot: { create: { ...override, note: null, isBackfilled: false } } } : {}),
    ...(styleOverride
      ? {
          suitType: styleOverride.suitType,
          collarType: styleOverride.collarType,
          bainType: styleOverride.bainType,
          cuffType: styleOverride.cuffType,
          gheraType: styleOverride.gheraType,
          pocketOption: styleOverride.pocketOptionId ? { connect: { id: styleOverride.pocketOptionId } } : undefined,
        }
      : {}),
  };
}

/**
 * The same override fields as newOrderItemFields, shaped for an UPDATE to
 * an ALREADY-EXISTING OrderItem instead. The crucial difference: a
 * Prisma `update` silently leaves an omitted field untouched, so an
 * override that existed before but was removed in this edit must be
 * explicitly cleared (null / disconnect) rather than simply left out —
 * newOrderItemFields' "just omit it" shape is wrong here for exactly that
 * reason, which is why this is its own function rather than one shared
 * with it.
 */
export function updatedOrderItemFields(
  override: ReturnType<typeof toMeasurementValueData> | null,
  styleOverride: ItemStyleOverride | null
): Prisma.OrderItemUpdateInput {
  return {
    measurementSnapshot: override ? { create: { ...override, note: null, isBackfilled: false } } : { disconnect: true },
    ...(styleOverride
      ? {
          suitType: styleOverride.suitType,
          collarType: styleOverride.collarType,
          bainType: styleOverride.bainType,
          cuffType: styleOverride.cuffType,
          gheraType: styleOverride.gheraType,
          pocketOption: styleOverride.pocketOptionId ? { connect: { id: styleOverride.pocketOptionId } } : { disconnect: true },
        }
      : { suitType: null, collarType: null, bainType: null, cuffType: null, gheraType: null, pocketOption: { disconnect: true } }),
  };
}
