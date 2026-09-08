import { Prisma, OrderStatus, type SuitType, type CollarType, type BainType, type CuffType, type GheraType } from "@prisma/client";
import type { toMeasurementValueData } from "@/lib/measurement-value";

// Extracted (Step 25) into its own plain module — a "use server" file's
// exports must all be async Server Actions, and buildOrderCreateData is
// a pure, synchronous data builder both order-actions.ts's createOrder
// and the combined new-customer+order action (customer-order-actions.ts)
// need to share rather than duplicate.

export interface ValidatedOrderInput {
  orderDate: Date;
  deliveryDate: Date;
  suitType: SuitType;
  collarType: CollarType;
  bainType: BainType;
  cuffType: CuffType;
  gheraType: GheraType;
  pocketOptionId?: string;
  totalAmount: string;
  advanceAmount: string;
  balanceAmount: string;
  note: string | null;
  quantity: number;
  defaultSnapshotData: ReturnType<typeof toMeasurementValueData> & { note: string | null; isBackfilled: boolean };
  itemOverrides: (ReturnType<typeof toMeasurementValueData> | null)[];
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
    totalAmount: validated.totalAmount,
    advanceAmount: validated.advanceAmount,
    balanceAmount: validated.balanceAmount,
    status: OrderStatus.NEW,
    createdBy: { connect: { id: sessionSub } },
    note: validated.note,
    defaultMeasurementSnapshot: { create: validated.defaultSnapshotData },
    items: {
      create: validated.itemOverrides.map((override, index) => ({
        position: index + 1,
        ...(override ? { measurementSnapshot: { create: { ...override, note: null, isBackfilled: false } } } : {}),
      })),
    },
  };
}
