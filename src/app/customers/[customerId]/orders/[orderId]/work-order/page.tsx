import { notFound } from "next/navigation";
import { getOrderPrintData, type OrderPrintData, type OrderPrintSuit } from "@/lib/order-print-data";
import { PrintPreviewShell } from "@/components/print/print-preview-shell";
import { MeasurementSnapshotPrintGrid } from "@/components/print/measurement-snapshot-print-grid";
import { WorkOrderStyleBox } from "@/components/print/work-order-style-box";
import { formatOrderNumber } from "@/lib/format";
import { en } from "@/lib/locale";
import {
  SUIT_TYPE_UR,
  COLLAR_TYPE_UR,
  BAIN_TYPE_UR,
  CUFF_TYPE_UR,
  GHERA_TYPE_UR,
  WORK_ORDER_UR,
  suitOfTotalUr,
} from "@/lib/work-order-style-labels";

// Karigar Work Order print preview — Urdu/RTL content (Step 22), now laid
// out two-per-A4-landscape-sheet with a cut guide between them (Step 23,
// design brief §7a: "Two work orders per A4, cut down the middle. Halves
// paper cost and A5 is close to the pad size their hands already know.").
// Only THIS page's own printable content is RTL/landscape — the
// surrounding PrintPreviewShell (PageHeader, back link, Print button)
// stays exactly as it is: plain English/LTR chrome, untouched, shared
// with the still-portrait, still-English Receipt page. The `wide` prop
// only widens the on-screen preview container; print output already
// ignores it (`print:max-w-none`) regardless.
//
// No money anywhere on this sheet (never was, still isn't). Order date
// and status stay dropped, matching Step 22's decision (neither appears
// in the authoritative mockup's own print template).
export default async function WorkOrderPage({
  params,
}: {
  params: { customerId: string; orderId: string };
}) {
  const data = await getOrderPrintData(params.customerId, params.orderId);
  if (!data) {
    notFound();
  }

  const { order, suits } = data;
  const customer = order.customer;
  const orderHref = `/customers/${customer.id}/orders/${order.id}`;

  // Only the style groups that actually have a value print at all — the
  // 5 enum-backed groups always do (none of those columns are nullable),
  // Pocket only when one was actually selected. Pocket's real design
  // names aren't confirmed data yet (see work-order-style-labels.ts), so
  // its box shows the DesignOption's own stored label as-is rather than
  // an invented Urdu translation.
  const styleBoxes: string[] = [
    SUIT_TYPE_UR[order.suitType],
    COLLAR_TYPE_UR[order.collarType],
    BAIN_TYPE_UR[order.bainType],
    CUFF_TYPE_UR[order.cuffType],
    GHERA_TYPE_UR[order.gheraType],
  ];
  if (order.pocketOption) {
    styleBoxes.push(order.pocketOption.label);
  }

  const deliveryDateText = order.deliveryDate ? formatDateNumeric(order.deliveryDate) : "—";

  // Two suits per physical sheet (left = odd position, right = even) —
  // grouping whole suits only. A suit's own content is never split
  // across sheets, and an odd suit count's trailing right half is simply
  // left empty rather than stretching or repeating a suit.
  const sheets: [OrderPrintSuit, OrderPrintSuit | null][] = [];
  for (let i = 0; i < suits.length; i += 2) {
    sheets.push([suits[i], suits[i + 1] ?? null]);
  }

  return (
    <PrintPreviewShell
      headerTitle={en.print.workOrder.pageTitle}
      backHref={orderHref}
      backLabel={en.print.backToOrder}
      printLabel={en.print.workOrder.printButton}
      wide
    >
      {/* Step 23: A4 landscape, scoped to this route's own print job only
          — see print-preview-shell.tsx's comment on why this can never
          reach the Receipt page's print output. */}
      <style>{"@media print { @page { size: A4 landscape; margin: 8mm; } }"}</style>

      <div className="space-y-8 print:space-y-0">
        {sheets.map((pair, sheetIndex) => (
          <div
            key={sheetIndex}
            className={`grid grid-cols-2 overflow-hidden rounded-sm border border-rule bg-card print:break-inside-avoid print:rounded-none print:border-2 print:border-black ${
              sheetIndex < sheets.length - 1 ? "print:break-after-page" : ""
            }`}
            style={{ aspectRatio: "297 / 210" }}
          >
            <WorkOrderHalf order={order} suit={pair[0]} totalSuits={suits.length} styleBoxes={styleBoxes} deliveryDateText={deliveryDateText} />

            {/* The dashed edge here IS the cut/fold guide (design brief
                §7a) — a plain print-safe border, not application content,
                sitting exactly on the boundary between the two halves.
                Left empty (no WorkOrderHalf rendered inside) when this
                sheet only has one suit — a genuinely blank half, never a
                duplicate. */}
            <div className="border-l border-dashed border-graphite/40 print:border-black">
              {pair[1] && (
                <WorkOrderHalf order={order} suit={pair[1]} totalSuits={suits.length} styleBoxes={styleBoxes} deliveryDateText={deliveryDateText} />
              )}
            </div>
          </div>
        ))}
      </div>
    </PrintPreviewShell>
  );
}

function WorkOrderHalf({
  order,
  suit,
  totalSuits,
  styleBoxes,
  deliveryDateText,
}: {
  order: OrderPrintData["order"];
  suit: OrderPrintSuit;
  totalSuits: number;
  styleBoxes: string[];
  deliveryDateText: string;
}) {
  return (
    <div dir="rtl" className="flex h-full flex-col p-4 print:p-3">
      {/* Order number huge at the top (design brief §7a) — this is how a
          bundle gets found in a pile of two hundred. */}
      <div className="flex items-start justify-between border-b-2 border-graphite pb-2 print:border-black">
        <div>
          <div dir="ltr" className="text-5xl font-bold leading-none tabular-nums text-graphite print:text-black">
            {formatOrderNumber(order.orderNumber)}
          </div>
          <div className="mt-1 font-nastaliq text-sm text-graphite print:text-black">{suitOfTotalUr(suit.position, totalSuits)}</div>
        </div>
        <div className="font-nastaliq text-lg leading-relaxed text-graphite print:text-black">{en.app.nameUrdu}</div>
      </div>

      <div className="mt-3">
        <MeasurementSnapshotPrintGrid snapshot={suit.snapshot} />
      </div>

      {styleBoxes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-graphite pt-3 print:border-black">
          {styleBoxes.map((label, index) => (
            <WorkOrderStyleBox key={index} label={label} />
          ))}
        </div>
      )}

      {/* Spacer — pushes the delivery-date footer to the bottom of the
          sheet regardless of how much content is above it, matching the
          mockup's own flex:1 spacer in the same spot. */}
      <div className="flex-1" />

      <div className="flex items-end justify-between border-t-2 border-graphite pt-2 print:border-black">
        <span className="font-nastaliq text-base text-graphite print:text-black">{WORK_ORDER_UR.deliveryDateLabel}</span>
        <span dir="ltr" style={{ unicodeBidi: "isolate" }} className="text-3xl font-bold tabular-nums text-graphite print:text-black">
          {deliveryDateText}
        </span>
      </div>
    </div>
  );
}

/** "30-08-2026" — plain numeric Latin digits, matching the mockup's own date format exactly (no English month word inside an otherwise all-Urdu document). Local calendar date, not UTC-shifted. */
function formatDateNumeric(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}
