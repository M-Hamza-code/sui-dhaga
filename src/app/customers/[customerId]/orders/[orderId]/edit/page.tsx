import { notFound } from "next/navigation";
import type { CollarType, BainType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrderPrintData } from "@/lib/order-print-data";
import { fromSnapshot } from "@/lib/measurement-prefill";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { OrderForm, type OrderEditData } from "@/components/orders/order-form";
import { en } from "@/lib/locale";

/**
 * Step 63 — Collar and Bain are now a single combined choice (exactly
 * one, never both). An order (or per-suit override) saved BEFORE this
 * change may still have both columns set in the database — the
 * migration is purely additive and never retroactively touched existing
 * rows. Collar wins when opening such an order for edit; saving it again
 * (even unchanged) naturally migrates it to the new single-choice shape,
 * the same way stale-shape data elsewhere in this app heals itself on
 * next write rather than needing a one-off backfill script.
 */
function normalizeCollarBain(
  collarType: CollarType | null,
  bainType: BainType | null
): { collarType: CollarType | ""; bainType: BainType | "" } {
  if (collarType) return { collarType, bainType: "" };
  return { collarType: "", bainType: bainType ?? "" };
}

// Step 53 — Edit Order. Reuses getOrderPrintData() (order-print-data.ts)
// completely unchanged — the exact same order + customer + pocketOption/
// pattiOption + defaultMeasurementSnapshot + per-suit items/style
// resolution the Receipt and Work Order print pages already use, so this
// form always opens with the same values those pages (and Order Detail)
// currently show. No new query logic, no second resolution of "what's
// this suit's actual style/measurement" — see that function's own
// comment for the inherit-unless-overridden rule being reused here.
//
// Deliberately NOT local-first for the initial page load — unlike a new
// order, an order reachable here is guaranteed to already exist in
// Postgres (Order Detail, where the "Edit Order" link lives, 404s
// otherwise), so there is always a real server row to read. SAVING the
// edit, by contrast, is fully local-first (see order-form.tsx's
// handleSubmit / enqueueUpdateOrder) — the one actual offline-first
// requirement this feature has.
export default async function EditOrderPage({
  params,
}: {
  params: { customerId: string; orderId: string };
}) {
  const [data, pocketOptions, pattiOptions] = await Promise.all([
    getOrderPrintData(params.customerId, params.orderId),
    prisma.designOption.findMany({
      where: { category: "POCKET", isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.designOption.findMany({
      where: { category: "PATTI", isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  if (!data) {
    notFound();
  }

  const { order, suits } = data;
  const customer = order.customer;

  // Same rule Order Detail already applies before showing its own Edit
  // Order link (see that page's isDeleted check) — enforced again here
  // as defense in depth for anyone reaching this URL directly. Editing a
  // soft-deleted customer's order is rejected the same way order
  // creation and status changes already are (customer-not-found —
  // order-update.ts), so this page simply never gets that far.
  if (customer.deletedAt) {
    notFound();
  }

  const orderCollarBain = normalizeCollarBain(order.collarType, order.bainType);

  const orderData: OrderEditData = {
    orderId: order.id,
    orderDateDisplay: order.orderDate.toISOString().slice(0, 10),
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString().slice(0, 10) : "",
    suitType: order.suitType,
    collarType: orderCollarBain.collarType,
    bainType: orderCollarBain.bainType,
    cuffType: order.cuffType,
    gheraType: order.gheraType,
    pocketOptionId: order.pocketOptionId ?? "",
    pattiOptionId: order.pattiOptionId ?? "",
    // .toFixed(2), not .toString() — Decimal.js's own toString() drops
    // insignificant trailing zeros ("9999" instead of the stored
    // "9999.00"), which MONEY_REGEX still accepts (its decimal part is
    // optional) so this was never a validation/precision bug, just a
    // confusing display the moment the edit form opens.
    totalAmount: order.totalAmount.toFixed(2),
    advanceAmount: order.advanceAmount.toFixed(2),
    note: order.note ?? "",
    baseUpdatedAt: order.updatedAt.toISOString(),
    defaultMeasurement: order.defaultMeasurementSnapshot ? fromSnapshot(order.defaultMeasurementSnapshot) : null,
    defaultNote: order.defaultMeasurementSnapshot?.note ?? "",
    items: suits.map((suit) => ({
      position: suit.position,
      override: suit.isOverride,
      measurement: suit.isOverride && suit.snapshot ? fromSnapshot(suit.snapshot) : null,
      style: suit.isStyleOverride
        ? {
            suitType: suit.style.suitType,
            ...normalizeCollarBain(suit.style.collarType, suit.style.bainType),
            cuffType: suit.style.cuffType,
            gheraType: suit.style.gheraType,
            pocketOptionId: suit.style.pocketOption?.id ?? "",
          }
        : null,
    })),
  };

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader
        title={en.orderForm.editHeading}
        backHref={`/customers/${customer.id}/orders/${order.id}`}
        backLabel={en.print.backToOrder}
      />

      <PageContainer size="lg">
        <h1 className="text-xl font-semibold text-graphite">{en.orderForm.editHeading}</h1>
        <p className="mt-1 text-sm text-graphite/60">
          {customer.name} · <span className="tabular-nums">{customer.phonePrimary}</span>
        </p>

        <OrderForm
          mode="edit"
          customerId={customer.id}
          // Step 61 — root-cause fix. This page's own getOrderPrintData()
          // call above already read `customer` live from Postgres THIS
          // request, and notFound() already fired if it were missing or
          // soft-deleted (see the two guards above) — so by this point
          // the customer's existence is already a certainty, strictly
          // stronger than anything OrderForm's own client-side mount
          // effect could re-derive from Dexie. That effect (Phase 6,
          // "confirms the customer exists SOMEWHERE") exists for the
          // *new*-order pages, which have no such server-side guarantee
          // of their own. Never passing this prop here left it at its
          // `false` default, so a brand-new order's customer — real on
          // the server, but not yet re-pulled into this device's local
          // Dexie mirror since creation — was wrongly reported as "not
          // found locally or on the server" the moment Edit was opened
          // right after creating it. Older orders never showed this: by
          // the time they were edited, some later page load had already
          // re-synced Dexie, masking the same missing prop. Passing the
          // already-proven `true` here removes the false negative
          // entirely, the same way orders/new/page.tsx's own
          // `customerExists={!!customer && !customer.deletedAt}` already
          // does for its own (weaker, no-guarantee) case.
          customerExists
          orderData={orderData}
          measurement={null}
          pocketOptions={pocketOptions}
          pattiOptions={pattiOptions}
        />
      </PageContainer>
    </main>
  );
}
