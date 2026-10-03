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
import {
  SUIT_TYPE_IMAGES,
  COLLAR_TYPE_IMAGES,
  BAIN_TYPE_IMAGES,
  CUFF_TYPE_IMAGES,
  GHERA_TYPE_IMAGES,
  DESIGN_OPTION_IMAGES,
} from "@/lib/order-options";

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

  // Step 50 — each suit's own style boxes, resolved by getOrderPrintData
  // (item override, or inherited from the order — same rule as the
  // measurement snapshot). Was a single shared array computed once from
  // order.* directly; now built per suit so a multi-suit order where
  // suit 2 has a different collar/cuff/etc. than suit 1 prints correctly
  // on each half. A single-suit order (or any suit with no override)
  // still resolves to exactly the order's own style — unchanged output
  // for every existing order. Only the 5 enum-backed groups always show
  // (none of those columns are nullable); Pocket only when one was
  // actually selected for that suit. Pocket's real design names aren't
  // confirmed data yet (see work-order-style-labels.ts), so its box shows
  // the DesignOption's own stored label as-is rather than an invented
  // Urdu translation.
  //
  // Step 58 — each box now also carries `imageSrc`, the same design
  // photo the on-screen Order Form tile for that exact selection shows
  // (SUIT_TYPE_IMAGES etc. / DESIGN_OPTION_IMAGES — order-options.ts's
  // single source of truth, keyed the same way its label counterparts
  // already are). Never guessed/invented here — a category with no
  // matching image just renders a box with no photo, same as an
  // unselected Pocket/Patti already renders no box at all. Patti Style
  // is order-level only (no per-suit override — see Order.pattiOptionId's
  // own schema comment), so every suit's box for it is the same value,
  // read from `order.pattiOption` rather than `suit.style`.
  function styleBoxesForSuit(suit: OrderPrintSuit): { label: string; imageSrc?: string }[] {
    const boxes: { label: string; imageSrc?: string }[] = [
      { label: SUIT_TYPE_UR[suit.style.suitType], imageSrc: SUIT_TYPE_IMAGES[suit.style.suitType] },
      { label: CUFF_TYPE_UR[suit.style.cuffType], imageSrc: CUFF_TYPE_IMAGES[suit.style.cuffType] },
      { label: GHERA_TYPE_UR[suit.style.gheraType], imageSrc: GHERA_TYPE_IMAGES[suit.style.gheraType] },
    ];
    // Step 63 — Collar and Bain are now a single combined choice
    // (exactly one set, never both, never neither) — each box only
    // prints when that field actually has a value, the same conditional
    // pattern Pocket/Patti already use just below. A legacy suit saved
    // before this change may still have both set and will correctly
    // print both boxes.
    if (suit.style.collarType) {
      boxes.push({ label: COLLAR_TYPE_UR[suit.style.collarType], imageSrc: COLLAR_TYPE_IMAGES[suit.style.collarType] });
    }
    if (suit.style.bainType) {
      boxes.push({ label: BAIN_TYPE_UR[suit.style.bainType], imageSrc: BAIN_TYPE_IMAGES[suit.style.bainType] });
    }
    if (suit.style.pocketOption) {
      boxes.push({ label: suit.style.pocketOption.label, imageSrc: DESIGN_OPTION_IMAGES[suit.style.pocketOption.code] });
    }
    if (order.pattiOption) {
      boxes.push({ label: order.pattiOption.label, imageSrc: DESIGN_OPTION_IMAGES[order.pattiOption.code] });
    }
    return boxes;
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
            // Step 59 fixed the forced HEIGHT (aspect-ratio now print-
            // only). Step 60 fixed the remaining forced WIDTH for a
            // sheet with only one real suit, but used a PERCENTAGE
            // (max-w-[50%]) — which, nested inside the outer card's own
            // w-fit (Step 61, needed so the card hugs its actual content
            // instead of staying a fixed wide box), is a genuinely
            // ambiguous CSS combination: a percentage-width descendant
            // inside a shrink-to-fit ancestor has no single well-defined
            // resolution, and browsers do not compute it consistently —
            // confirmed by direct measurement (an unexplained ~153px gap
            // alongside a too-narrow receipt, neither of which was ever
            // the intended "half of the original width" design).
            //
            // Step 62 — replaces the percentage with the exact ABSOLUTE
            // pixel width that half of the original grid-cols-2 sheet
            // has always computed to, given this route's own unchanged
            // architecture constants (none customized in
            // tailwind.config.ts): the outer wrapper's max-w-5xl (1024px)
            // minus its own p-6 (24px each side) minus this card's own
            // p-8 (32px each side), halved — (1024 - 48 - 64) / 2 =
            // 456px. An absolute value has no ancestor to resolve
            // against, so nesting it inside the card's w-fit is no
            // longer ambiguous — the card now hugs this exact width with
            // only its own p-8 as the gap, deterministically, the same
            // in every browser. Printed output is completely unaffected:
            // print: variants still restore the exact original full-
            // width, two-column, A4-landscape shape (print:grid-cols-2
            // print:max-w-none print:mx-0), because the physical two-
            // per-A4, cut-down-the-middle page this was built for still
            // needs consistent paper dimensions regardless of a blank
            // half.
            className={`overflow-hidden rounded-sm border border-rule bg-card print:aspect-[297/210] print:break-inside-avoid print:rounded-none print:border-2 print:border-black ${
              pair[1]
                ? "grid grid-cols-2"
                : "mx-auto grid max-w-[456px] grid-cols-1 print:mx-0 print:max-w-none print:grid-cols-2"
            } ${sheetIndex < sheets.length - 1 ? "print:break-after-page" : ""}`}
          >
            <WorkOrderHalf order={order} suit={pair[0]} totalSuits={suits.length} styleBoxes={styleBoxesForSuit(pair[0])} deliveryDateText={deliveryDateText} />

            {/* The dashed edge here IS the cut/fold guide (design brief
                §7a) — a plain print-safe border, not application content,
                sitting exactly on the boundary between the two halves.
                On screen, with nothing in pair[1], this whole column is
                now hidden rather than rendered blank-but-visible (Step
                60) — print:block brings it straight back for the actual
                paper output, where a genuinely blank cut-away half is
                still exactly what's wanted. */}
            <div className={`border-l border-dashed border-graphite/40 print:border-black ${pair[1] ? "" : "hidden print:block"}`}>
              {pair[1] && (
                <WorkOrderHalf order={order} suit={pair[1]} totalSuits={suits.length} styleBoxes={styleBoxesForSuit(pair[1])} deliveryDateText={deliveryDateText} />
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
  styleBoxes: { label: string; imageSrc?: string }[];
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
          {styleBoxes.map((box, index) => (
            <WorkOrderStyleBox key={index} label={box.label} imageSrc={box.imageSrc} />
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
