// Shared data loader for both print-preview routes (Customer Receipt and
// Karigar Work Order — Step 16). Not because the two documents look
// alike — they don't — but because both need exactly the same order
// graph, the same cross-customer safety check the order detail page
// already uses, and the same shop-settings row, so that logic lives in
// one place instead of two copies that could quietly drift apart.
import { prisma } from "@/lib/prisma";

export async function getOrderPrintData(customerId: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      pocketOption: true,
      pattiOption: true,
      defaultMeasurementSnapshot: true,
      // Step 50 — pocketOption added so a per-suit pocket override (see
      // OrderItem's own schema comment) can be resolved below without a
      // second query.
      items: { orderBy: { position: "asc" }, include: { measurementSnapshot: true, pocketOption: true } },
    },
  });

  // Identical rule to the order detail page (Step 14): an order that
  // exists but under a different customer's path is treated exactly like
  // a nonexistent order — never confirm it exists elsewhere. Soft-deleted
  // customers are deliberately NOT blocked here, matching the order
  // detail page's own behaviour — the owner can still reprint a past
  // receipt/work order for a since-deleted customer's historical order.
  if (!order || order.customerId !== customerId) {
    return null;
  }

  // Singleton row (Step 9) — `findUnique` on the unique `singleton` flag.
  // A brand-new install with no ShopSettings row at all must not crash;
  // every caller treats `shopSettings: null` the same as "nothing filled
  // in yet" and falls back to hiding the field, never inventing one.
  const shopSettings = await prisma.shopSettings.findUnique({ where: { singleton: true } });

  // Per-suit measurement resolution (Step 9/14's own rule, applied here
  // exactly as written — never re-derived differently):
  //   - an OrderItem with its own measurementSnapshotId uses that override
  //   - otherwise it inherits the order's defaultMeasurementSnapshot
  // NEVER the customer's current live Measurement — that would silently
  // break snapshot immutability for every order ever printed again after
  // the customer's measurements later change.
  //
  // Orders created before Step 14 have zero OrderItem rows. Every order
  // is at least one physical suit, so — the same honest fallback already
  // used by the customer profile page's order list and the Order Board's
  // suit-count column — that case is presented as a single synthetic
  // "Suit 1" using whatever default snapshot (if any) the order has,
  // rather than showing zero suits or crashing.
  // Step 50 — per-suit STYLE resolution, the exact same inherit-unless-
  // set rule as the measurement snapshot above, applied independently:
  // an item with its own suitType uses its own six style fields; every
  // other item (including every pre-Step-50 order's items, which have
  // none of these columns set) inherits the order's own style. Position 1
  // never has its own override (see OrderItem's schema comment) so it
  // always falls into the "inherit" branch here.
  const suits =
    order.items.length > 0
      ? order.items.map((item) => ({
          position: item.position,
          isOverride: item.measurementSnapshot !== null,
          snapshot: item.measurementSnapshot ?? order.defaultMeasurementSnapshot,
          isStyleOverride: item.suitType !== null,
          style: {
            suitType: item.suitType ?? order.suitType,
            collarType: item.collarType ?? order.collarType,
            bainType: item.bainType ?? order.bainType,
            cuffType: item.cuffType ?? order.cuffType,
            gheraType: item.gheraType ?? order.gheraType,
            pocketOption: item.suitType !== null ? item.pocketOption : order.pocketOption,
          },
        }))
      : [
          {
            position: 1,
            isOverride: false,
            snapshot: order.defaultMeasurementSnapshot,
            isStyleOverride: false,
            style: {
              suitType: order.suitType,
              collarType: order.collarType,
              bainType: order.bainType,
              cuffType: order.cuffType,
              gheraType: order.gheraType,
              pocketOption: order.pocketOption,
            },
          },
        ];

  return { order, shopSettings, suits };
}

export type OrderPrintData = NonNullable<Awaited<ReturnType<typeof getOrderPrintData>>>;
export type OrderPrintSuit = OrderPrintData["suits"][number];
