import { notFound } from "next/navigation";
import { getOrderPrintData } from "@/lib/order-print-data";
import { PrintPreviewShell } from "@/components/print/print-preview-shell";
import { formatDate, formatMoney, formatOrderNumber } from "@/lib/format";
import { en } from "@/lib/locale";
import type { Metadata } from "next";

// Page title for the browser tab / history entry (and, on the print
// routes, the browser's own printed page header). The root layout's
// metadata.title template turns this into "Receipt · Sui Dhaga".
export const metadata: Metadata = { title: "Receipt" };

// Customer Receipt print preview (Step 16 Part D). Deliberately compact —
// this is what the customer walks out holding, not an internal record:
// shop info, who/what/when, suit count, and the payment summary. No
// design/style detail, no measurements — that's the Work Order's job.
export default async function ReceiptPage({
  params,
}: {
  params: { customerId: string; orderId: string };
}) {
  const data = await getOrderPrintData(params.customerId, params.orderId);
  if (!data) {
    notFound();
  }

  const { order, shopSettings, suits } = data;
  const customer = order.customer;
  const orderHref = `/customers/${customer.id}/orders/${order.id}`;

  // Requirement 6 — Receipt gets the same Prince Coat/Waistcoat pricing
  // breakdown (garment, quantity, unit price, subtotal) the Order Detail
  // page already shows, using each Coat-mode suit's own explicit,
  // persisted garmentSelection (getOrderPrintData() already resolves a
  // legacy NULL to "BOTH"). The Work Order deliberately keeps its own
  // existing "no money anywhere on this sheet" rule untouched (see that
  // page's own comment) — this breakdown is Receipt-only.
  //
  // "Only bill for garments actually ordered" — a suit only counts
  // toward a garment's quantity if it's BOTH structurally that garment
  // (coatGarmentSelection includes it) AND actually has real measurement
  // data for it (hasPrinceCoatData/hasWaistcoatData, from
  // getOrderPrintData()'s own resolution — see garment-ordered.ts). A
  // Coat tab that was opened (defaulting its quantity to 1) but never
  // filled in contributes to neither.
  let princeCoatQuantity = 0;
  let waistcoatQuantity = 0;
  for (const suit of suits) {
    if (suit.measurementMode !== "COAT") continue;
    if ((suit.coatGarmentSelection === "PRINCE_COAT" || suit.coatGarmentSelection === "BOTH") && suit.hasPrinceCoatData) princeCoatQuantity++;
    if ((suit.coatGarmentSelection === "WAISTCOAT" || suit.coatGarmentSelection === "BOTH") && suit.hasWaistcoatData) waistcoatQuantity++;
  }
  const princeCoatTotal = princeCoatQuantity > 0 && order.princeCoatUnitPrice ? Number(order.princeCoatUnitPrice) * princeCoatQuantity : null;
  const waistcoatTotal = waistcoatQuantity > 0 && order.waistcoatUnitPrice ? Number(order.waistcoatUnitPrice) * waistcoatQuantity : null;
  // Same rule applied to Kameez/Shalwar — true only if at least one
  // Kameez-mode suit is actually ordered (Suit Type selected or
  // measurements entered — see hasKameezData's own comment).
  const kameezOrdered = suits.some((suit) => suit.measurementMode !== "COAT" && suit.hasKameezData);

  // Order Type Selection upgrade — a mixed order (Kameez/Shalwar AND
  // Coat/Waistcoat together) now also gets its own itemized
  // Kameez/Shalwar line, computed as "whatever portion of the already-
  // frozen Total isn't accounted for by the already-frozen Prince
  // Coat/Waistcoat amounts" — never from the shop's CURRENT default
  // suit-type prices (which, unlike princeCoatUnitPrice/waistcoatUnitPrice,
  // were never frozen onto the order and could have changed since this
  // order was placed). This keeps historical reprints exactly accurate
  // using only figures already saved on this order, and the three rows
  // always sum to the same real Total/Balance shown below. A Kameez-only
  // order (no Coat entries at all) is unaffected — it keeps showing just
  // the single combined Total it always has, with no new line.
  const hasCoatEntries = princeCoatQuantity > 0 || waistcoatQuantity > 0;
  const kameezShalwarTotal =
    hasCoatEntries && kameezOrdered ? Number(order.totalAmount) - (princeCoatTotal ?? 0) - (waistcoatTotal ?? 0) : null;

  return (
    <PrintPreviewShell
      headerTitle={en.print.receipt.pageTitle}
      backHref={orderHref}
      backLabel={en.print.backToOrder}
      printLabel={en.print.receipt.printButton}
    >
      <div className="text-center">
        {/* ShopSettings is a single optional row (Step 9) — every field
            below is shown only if it actually has a value. Nothing here
            is invented; an empty/missing field is simply hidden, never
            filled with a placeholder. */}
        <p className="text-xl font-semibold text-ink print:text-black">{shopSettings?.name || en.app.name}</p>
        {shopSettings?.tagline && <p className="text-xs text-graphite/60 print:text-black">{shopSettings.tagline}</p>}
        {(shopSettings?.address || shopSettings?.phone) && (
          <p className="mt-0.5 text-xs text-graphite/60 print:text-black">
            {[shopSettings?.address, shopSettings?.phone].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="mt-2 text-xs uppercase tracking-widest text-graphite/50 print:text-black">
          {en.print.receipt.documentLabel}
        </p>
      </div>

      <div className="mt-5 flex items-baseline justify-between border-y border-rule py-3 print:border-black">
        <span className="text-3xl font-bold tabular-nums text-ink print:text-black">{formatOrderNumber(order.orderNumber)}</span>
        <div className="text-right">
          <p className="font-medium text-graphite print:text-black">{customer.name}</p>
          <p className="tabular-nums text-sm text-graphite/70 print:text-black">{customer.phonePrimary}</p>
        </div>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <Row label={en.print.receipt.orderDate} value={formatDate(order.orderDate)} />
        <Row label={en.print.receipt.deliveryDate} value={order.deliveryDate ? formatDate(order.deliveryDate) : "—"} />
        <Row label={en.print.receipt.status} value={en.status[order.status]} />
        <Row
          label={en.print.receipt.suits}
          value={
            suits.length === 1
              ? en.print.receipt.suitLabelTemplate.replace("{n}", "1")
              : suits.map((s) => en.print.receipt.suitLabelTemplate.replace("{n}", String(s.position))).join(", ")
          }
        />
      </dl>

      {hasCoatEntries && (
        <dl className="mt-4 space-y-1.5 border-t border-rule pt-4 text-sm print:border-black">
          {kameezShalwarTotal !== null && (
            <Row label={en.orderForm.kameezShalwarTotal} value={formatMoney(kameezShalwarTotal)} />
          )}
          {princeCoatQuantity > 0 && (
            <Row
              label={`${en.orderForm.princeCoatTotal} (${princeCoatQuantity} × Rs. ${order.princeCoatUnitPrice?.toFixed(2) ?? "—"})`}
              value={princeCoatTotal !== null ? formatMoney(princeCoatTotal) : "—"}
            />
          )}
          {waistcoatQuantity > 0 && (
            <Row
              label={`${en.orderForm.waistcoatTotal} (${waistcoatQuantity} × Rs. ${order.waistcoatUnitPrice?.toFixed(2) ?? "—"})`}
              value={waistcoatTotal !== null ? formatMoney(waistcoatTotal) : "—"}
            />
          )}
        </dl>
      )}

      <dl className="mt-5 space-y-1.5 border-t border-rule pt-4 text-sm print:border-black">
        <Row label={en.print.receipt.total} value={formatMoney(order.totalAmount)} />
        <Row label={en.print.receipt.advance} value={formatMoney(order.advanceAmount)} />
        <div className="mt-1 flex items-baseline justify-between border-t border-rule pt-2 print:border-black">
          <dt className="font-semibold text-graphite print:text-black">{en.print.receipt.balance}</dt>
          <dd
            className={`text-lg font-bold tabular-nums ${Number(order.balanceAmount) > 0 ? "text-amber" : "text-graphite"} print:text-black`}
          >
            {formatMoney(order.balanceAmount)}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-center text-xs text-graphite/50 print:text-black">{en.print.receipt.thankYou}</p>
    </PrintPreviewShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-graphite/60 print:text-black">{label}</dt>
      <dd className="text-right tabular-nums text-graphite print:text-black">{value}</dd>
    </div>
  );
}
