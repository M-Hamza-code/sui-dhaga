import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOrderPrintData } from "@/lib/order-print-data";
import { fromSnapshot } from "@/lib/measurement-prefill";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { OrderForm, type OrderEditData } from "@/components/orders/order-form";
import { en } from "@/lib/locale";

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

  const orderData: OrderEditData = {
    orderId: order.id,
    orderDateDisplay: order.orderDate.toISOString().slice(0, 10),
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString().slice(0, 10) : "",
    suitType: order.suitType,
    collarType: order.collarType,
    bainType: order.bainType,
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
            collarType: suit.style.collarType,
            bainType: suit.style.bainType,
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
          orderData={orderData}
          measurement={null}
          pocketOptions={pocketOptions}
          pattiOptions={pattiOptions}
        />
      </PageContainer>
    </main>
  );
}
