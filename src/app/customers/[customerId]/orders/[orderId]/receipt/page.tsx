import { notFound } from "next/navigation";
import { getOrderPrintData } from "@/lib/order-print-data";
import { PrintPreviewShell } from "@/components/print/print-preview-shell";
import { formatDate, formatMoney, formatOrderNumber } from "@/lib/format";
import { en } from "@/lib/locale";

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
