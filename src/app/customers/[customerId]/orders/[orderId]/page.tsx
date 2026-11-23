import Link from "next/link";
import { notFound } from "next/navigation";
import type { MeasurementSnapshot } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatOrderNumber } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { OrderStatusForm } from "@/components/orders/order-status-form";
import { OrderPendingEditNotice } from "@/components/orders/order-pending-edit-notice";
import { OrderPrintLinks } from "@/components/orders/order-print-links";
import { DeleteOrderButton } from "@/components/orders/delete-order-button";
import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { COAT_FIELDS, WAISTCOAT_FIELDS } from "@/lib/coat-measurement-fields";
import { includesPrinceCoat, includesWaistcoat, unionCoatGarmentSelection, type CoatGarmentSelectionLike } from "@/lib/coat-garment-selection";
import { hasPrinceCoatMeasurementData, hasWaistcoatMeasurementData } from "@/lib/garment-ordered";
import type { MeasurementMode } from "@prisma/client";
import { toFractionDisplay } from "@/lib/fractions";
import { en } from "@/lib/locale";
import {
  SUIT_TYPE_LABELS,
  COLLAR_TYPE_LABELS,
  BAIN_TYPE_LABELS,
  CUFF_TYPE_LABELS,
  GHERA_TYPE_LABELS,
} from "@/lib/order-options";
import type { Metadata } from "next";

// Page title for the browser tab / history entry (and, on the print
// routes, the browser's own printed page header). The root layout's
// metadata.title template turns this into "Order · Sui Dhaga".
export const metadata: Metadata = { title: "Order" };

// S3's order detail view (Step 14 rebuild). Safely displays the Step 9
// multi-suit / snapshot graph — an order's default measurement snapshot
// and every OrderItem's own override, where it has one — without
// implementing S5 print preview or the S4 Order Board. Orders created
// before Step 14 (no items, no snapshot) still render correctly: the
// Suits/Default measurements sections just show their "nothing recorded"
// fallback instead of crashing on missing data.
//
// Step 50 — presentation-only redesign to match Steps 48/49's card
// language: PageContainer (size="lg", the same width Print Preview
// already uses for a single-order screen), a Customer-Profile-style
// identity/action header card (order number + tone-colored status
// control, print/receipt/WhatsApp actions inside the same card), and
// every section below now a SectionCard instead of hand-rolled
// <section><h2> markup. Payment gets the same honest amber/success
// balance callout the Order Form's Payment section already uses. Every
// query, the ownership check, OrderStatusForm's props, and every
// formatted value are byte-for-byte unchanged.
export default async function OrderDetailPage({
  params,
}: {
  params: { customerId: string; orderId: string };
}) {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: {
      customer: true,
      pocketOption: true,
      pattiOption: true,
      panchaOption: true,
      defaultMeasurementSnapshot: true,
      // Step 50 — pocketOption added so a per-suit pocket style override
      // can be shown below alongside the measurement override.
      items: { orderBy: { position: "asc" }, include: { measurementSnapshot: true, pocketOption: true } },
    },
  });

  // The order must belong to the customer in the URL. An order that
  // exists but under a different customer's path is treated exactly like
  // a nonexistent order — never confirm it exists elsewhere.
  if (!order || order.customerId !== params.customerId) {
    notFound();
  }

  const customer = order.customer;
  const isDeleted = customer.deletedAt !== null;
  const balanceOwed = Number(order.balanceAmount) > 0;
  // Requirement 4/6 — "Show correct quantities, individual prices,
  // subtotals" for Coat/Waistcoat on the Payment breakdown below. Each
  // Coat-mode item's own EXPLICIT garment selection (never measurement
  // content — see CoatGarmentSelection's own schema.prisma comment)
  // independently decides whether it counts toward princeCoatQuantity,
  // waistcoatQuantity, or both. NULL (a Coat item saved before this field
  // existed) is interpreted as BOTH for backward compatibility, same
  // fallback getOrderPrintData() already applies for the Edit page.
  const coatModeItems = order.items.filter((item) => (item.measurementMode ?? order.measurementMode) === "COAT");
  // "Only bill for garments actually ordered" — a Coat-mode item only
  // counts toward a garment's quantity if it's BOTH structurally that
  // garment AND actually has real measurement data for it (never merely
  // because its quantity defaulted to 1 when its tab was opened) — see
  // garment-ordered.ts's own comment.
  let princeCoatQuantity = 0;
  let waistcoatQuantity = 0;
  for (const item of coatModeItems) {
    const selection = item.coatGarmentSelection ?? "BOTH";
    const snapshot = item.measurementSnapshot ?? order.defaultMeasurementSnapshot;
    if ((selection === "PRINCE_COAT" || selection === "BOTH") && hasPrinceCoatMeasurementData(snapshot)) princeCoatQuantity++;
    if ((selection === "WAISTCOAT" || selection === "BOTH") && hasWaistcoatMeasurementData(snapshot)) waistcoatQuantity++;
  }
  const princeCoatTotal = princeCoatQuantity > 0 && order.princeCoatUnitPrice ? Number(order.princeCoatUnitPrice) * princeCoatQuantity : null;
  const waistcoatTotal = waistcoatQuantity > 0 && order.waistcoatUnitPrice ? Number(order.waistcoatUnitPrice) * waistcoatQuantity : null;

  // Measurement-group visibility fix — the "Default Measurements" card
  // below shows the ORDER's single shared snapshot, used by every
  // Coat-mode item that has no own override (measurementSnapshot ===
  // null). Its own Coat/Waistcoat visibility must be the union of what
  // those entries actually need — same rule, same helper, as the Order
  // Form's own shared-block computation (computeSharedCoatVisibleGroup).
  // Never affects pricing above, which is untouched.
  const sharedCoatItems = coatModeItems.filter((item) => !item.measurementSnapshot);
  const sharedCoatItemCount = sharedCoatItems.length;
  const sharedCoatVisibleGroup: CoatGarmentSelectionLike = unionCoatGarmentSelection(sharedCoatItems.map((item) => item.coatGarmentSelection ?? "BOTH")) ?? "BOTH";

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title="Order" backHref={`/customers/${customer.id}`} backLabel="Back to profile" />

      <PageContainer size="lg">
        <div className="rounded-sm border border-rule bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tabular-nums text-graphite">{formatOrderNumber(order.orderNumber)}</h1>
              <p className="mt-1 text-sm text-graphite/60">
                {customer.name} · <span className="tabular-nums">{customer.phonePrimary}</span>
              </p>
            </div>
            {isDeleted ? <StatusBadge status={order.status} /> : <OrderStatusForm customerId={customer.id} orderId={order.id} status={order.status} />}
          </div>

          {/* Step 16 print entry points — plain links to their own preview
              routes, not window.print() directly, so the owner always sees
              the document before printing it. Step 17 adds the WhatsApp
              entry point alongside them, same pattern: a link to a preview/
              selection page, never an immediate wa.me redirect. Step 53
              adds Edit Order the same way — a plain link to its own page,
              never an inline edit here — and, like OrderStatusForm right
              above, is hidden entirely for a soft-deleted customer's
              order (never offered somewhere the save would just be
              rejected server-side — see order-update.ts). */}
          {/* Each action below sits at px-3.5/py-2 rather than the
              original px-3/py-1.5 — roughly 38px instead of 30px. This
              is the app's most-used action cluster and it's used at a
              counter, frequently on a tablet, where a 30px target is
              genuinely hard to hit. Same actions, same order, same
              hrefs; a focus ring is added for the same reason it was
              added to the header's links. */}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
            {!isDeleted && (
              <Link
                href={`/customers/${customer.id}/orders/${order.id}/edit`}
                className="rounded-sm border border-rule px-3.5 py-2 text-sm text-graphite transition hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1"
              >
                {en.orderForm.editLinkLabel}
              </Link>
            )}
            <OrderPrintLinks customerId={customer.id} orderId={order.id} />
          </div>

          {/* Step 55 (Part 2) — on its own row: visually distinct from
              the neutral actions above (destructive, not routine), and
              deliberately NOT gated on isDeleted the way Edit
              Order/OrderStatusForm are — a stray order left over under an
              already-deleted customer (exactly last step's "Real Admin
              Customer" case) is precisely the kind of thing this button
              needs to be able to clean up, not hide from. */}
          <div className="mt-3 flex border-t border-rule pt-3">
            <DeleteOrderButton customerId={customer.id} orderId={order.id} orderNumberDisplay={formatOrderNumber(order.orderNumber)} />
          </div>

          {/* Step 53 — honest "not yet synced" notice; see that
              component's own comment for why this page doesn't try to be
              fully local-first. */}
          <OrderPendingEditNotice orderId={order.id} />
        </div>

        <div className="mt-6 space-y-6">
          <SectionCard title={en.orderDetail.orderInformation}>
            <dl className="divide-y divide-rule/60 text-sm">
              <Row label={en.orderDetail.orderDate} value={formatDate(order.orderDate)} />
              <Row label={en.orderDetail.deliveryDate} value={order.deliveryDate ? formatDate(order.deliveryDate) : "—"} />
              <Row label={en.orderDetail.status} value={en.status[order.status]} />
            </dl>
          </SectionCard>

          {/* Step 50 — this is suit 1's style: Order's own style fields
              are (and always have been) exactly one suit's worth of
              selections, and position 1 never has its own per-suit
              override (see OrderItem's schema comment), so it always
              reads these same fields. The heading now says so explicitly
              only when there's more than one suit, to avoid implying
              every suit shares this — the Suits section right below shows
              any suit 2+ that was configured differently. */}
          {/* A Coat-mode order has no Suit & Styles section at all — same
              rule the order form itself follows (none of these fields are
              ever submitted for one). */}
          {order.measurementMode !== "COAT" && (
          <SectionCard title={order.items.length > 1 ? en.orderDetail.designSelectionsSuit1 : en.orderDetail.designSelections}>
            <dl className="divide-y divide-rule/60 text-sm">
              {/* Upgrade — Suit Type/Cuff/Ghera can now each be "Not
                  Specified" (null), same conditional-row treatment
                  Collar/Bain/Patti/Pancha already use just below. */}
              {order.suitType && <Row label={en.orderDetail.suitType} value={SUIT_TYPE_LABELS[order.suitType]} />}
              {/* Step 63 — Collar and Bain are now a single combined
                  choice (exactly one set, never both, never neither) for
                  any order created/edited since; each row is shown only
                  when that field actually has a value, same conditional
                  pattern Pocket/Patti already use just below. A legacy
                  order saved before this change may still have both set
                  in the database (never retroactively altered — see the
                  migration's own comment) and will correctly show both
                  rows, an accurate reflection of what was actually
                  recorded at the time. */}
              {order.collarType && <Row label={en.orderDetail.collar} value={COLLAR_TYPE_LABELS[order.collarType]} />}
              {order.bainType && <Row label={en.orderDetail.bain} value={BAIN_TYPE_LABELS[order.bainType]} />}
              {order.cuffType && <Row label={en.orderDetail.cuff} value={CUFF_TYPE_LABELS[order.cuffType]} />}
              <Row label={en.orderDetail.pocket} value={order.pocketOption?.label ?? "—"} />
              {order.pattiOption && <Row label={en.orderDetail.patti} value={order.pattiOption.label} />}
              {order.panchaOption && <Row label={en.orderDetail.pancha} value={order.panchaOption.label} />}
              {order.gheraType && <Row label={en.orderDetail.ghera} value={GHERA_TYPE_LABELS[order.gheraType]} />}
            </dl>
          </SectionCard>
          )}

          <SectionCard title={en.orderDetail.suits}>
            {order.items.length === 0 ? (
              <p className="rounded-sm border border-dashed border-rule bg-paper p-4 text-sm text-graphite/60">
                {en.orderDetail.noSuitData}
              </p>
            ) : (
              <div className="space-y-3">
                {order.items.map((item) => (
                  <div key={item.id} className="rounded-sm border border-rule bg-paper p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-graphite">
                        {en.orderDetail.suitLabelTemplate.replace("{n}", String(item.position))}
                      </span>
                      <span className="text-xs text-graphite/50">
                        {item.measurementSnapshot ? en.orderDetail.overridden : en.orderDetail.sameAsDefault}
                      </span>
                    </div>
                    {/* Step 50 — a suit's own style, only shown when it was
                        actually configured differently from the order's
                        (suit 1's) style above; every other suit silently
                        shares that same style, exactly as before. */}
                    {/* Independent sections upgrade — every Coat/Waistcoat
                        entry is explicitly labeled as such (Kameez/Shalwar
                        suits need no equivalent label — that's this
                        section's own implied default). */}
                    {(item.measurementMode ?? order.measurementMode) === "COAT" && (
                      <p className="mt-1 text-xs text-graphite/50">{en.orderDetail.coatEntryLabel}</p>
                    )}
                    {item.suitType && (
                      <dl className="mt-2 divide-y divide-rule/50 rounded-sm border border-rule/60 bg-card px-3 text-sm">
                        <Row label={en.orderDetail.suitType} value={SUIT_TYPE_LABELS[item.suitType]} />
                        {/* Step 63 — same combined-choice conditional rendering as the order-level rows above. */}
                        {item.collarType && <Row label={en.orderDetail.collar} value={COLLAR_TYPE_LABELS[item.collarType]} />}
                        {item.bainType && <Row label={en.orderDetail.bain} value={BAIN_TYPE_LABELS[item.bainType]} />}
                        {/* Upgrade — Cuff/Ghera can now independently be "Not Specified" even when Suit Type itself was set. */}
                        {item.cuffType && <Row label={en.orderDetail.cuff} value={CUFF_TYPE_LABELS[item.cuffType]} />}
                        <Row label={en.orderDetail.pocket} value={item.pocketOption?.label ?? "—"} />
                        {item.gheraType && <Row label={en.orderDetail.ghera} value={GHERA_TYPE_LABELS[item.gheraType]} />}
                      </dl>
                    )}
                    {item.measurementSnapshot && (
                      <div className="mt-2">
                        <MeasurementSnapshotGrid
                          snapshot={item.measurementSnapshot}
                          mode={item.measurementMode ?? order.measurementMode}
                          coatVisibleGroup={item.coatGarmentSelection ?? "BOTH"}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title={en.orderDetail.defaultMeasurements}>
            {order.defaultMeasurementSnapshot ? (
              <div className="rounded-sm border border-rule bg-paper p-4">
                {/* Kameez/Shalwar grid — byte-for-byte unchanged (same
                    call, same mode, same output) per explicit instruction
                    not to touch existing Kameez/Shalwar behavior. */}
                <MeasurementSnapshotGrid snapshot={order.defaultMeasurementSnapshot} mode={order.measurementMode} />
                {/* Measurement-group visibility fix — a PURE ADDITION, not
                    a replacement: Order.measurementMode is always
                    KAMEEZ_SHALWAR under the current form (see this
                    order's own pricing comment above), so the line above
                    alone never rendered this order's actual Coat/
                    Waistcoat shared data for a Coat-only or mixed order —
                    a pre-existing display gap, not something this fix
                    introduces. Rendered only when at least one Coat-mode
                    item actually relies on this shared snapshot (has no
                    own override). */}
                {sharedCoatItemCount > 0 && (
                  <div className="mt-4 border-t border-rule pt-4">
                    <MeasurementSnapshotGrid snapshot={order.defaultMeasurementSnapshot} mode="COAT" coatVisibleGroup={sharedCoatVisibleGroup} />
                  </div>
                )}
                {order.defaultMeasurementSnapshot.note && (
                  <p className="mt-3 border-t border-rule pt-3 text-sm text-graphite">{order.defaultMeasurementSnapshot.note}</p>
                )}
              </div>
            ) : (
              <p className="rounded-sm border border-dashed border-rule bg-paper p-4 text-sm text-graphite/60">
                {en.orderDetail.noMeasurements}
              </p>
            )}
          </SectionCard>

          {/* Payment — Step 50: Balance now gets the same honest amber
              (still owed) / success (fully paid) callout the Order Form's
              own Payment section uses, instead of a plain dl row, so a
              glance tells the shop owner what's outstanding on this
              specific order. Total/Advance stay as the existing dl rows —
              only Balance changed treatment; every value is the same
              formatMoney(order.*) call as before. */}
          <SectionCard title={en.orderDetail.payment}>
            {/* Requirement 5 — Prince Coat/Waistcoat's own frozen unit
                price and quantity, shown only when this order actually
                has Coat/Waistcoat entries. Historically accurate even
                after a later Settings default price change, since these
                read the order's own persisted princeCoatUnitPrice/
                waistcoatUnitPrice, never today's Settings value. */}
            {(princeCoatQuantity > 0 || waistcoatQuantity > 0) && (
              <dl className="mb-3 divide-y divide-rule/40 rounded-sm border border-rule bg-paper px-3 text-sm">
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
            <dl className="divide-y divide-rule/60 text-sm">
              <Row label={en.orderDetail.total} value={formatMoney(order.totalAmount)} />
              <Row label={en.orderDetail.advance} value={formatMoney(order.advanceAmount)} />
            </dl>
            <div
              className={`mt-3 flex items-center justify-between rounded-sm border px-4 py-3 ${
                balanceOwed ? "border-amber bg-amber/10" : "border-success bg-success/10"
              }`}
            >
              <span className="text-sm font-medium text-graphite">{en.orderDetail.balance}</span>
              <span className={`text-xl font-semibold tabular-nums ${balanceOwed ? "text-amber" : "text-success"}`}>
                {formatMoney(order.balanceAmount)}
              </span>
            </div>
          </SectionCard>

          {order.note && (
            <SectionCard title={en.orderDetail.note}>
              <p className="text-sm text-graphite">{order.note}</p>
            </SectionCard>
          )}
        </div>

        {isDeleted && <p className="mt-6 text-sm text-graphite/50">{en.profile.deletedNotice}</p>}
      </PageContainer>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-graphite/60">{label}</dt>
      <dd className="text-right tabular-nums text-graphite">{value}</dd>
    </div>
  );
}

function MeasurementSnapshotGrid({
  snapshot,
  mode = "KAMEEZ_SHALWAR",
  coatVisibleGroup = "BOTH",
}: {
  snapshot: MeasurementSnapshot;
  mode?: MeasurementMode;
  /** Measurement-group visibility fix — filters which of the two Coat/Waistcoat groups actually render, using this specific item's own saved coatGarmentSelection (NULL already resolved to "BOTH" by the caller). Only consulted when mode === "COAT"; ignored otherwise. */
  coatVisibleGroup?: CoatGarmentSelectionLike;
}) {
  if (mode === "COAT") {
    return (
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {includesPrinceCoat(coatVisibleGroup) && <MeasurementGroup title={en.orderForm.princeCoatMeasurements} fields={COAT_FIELDS} snapshot={snapshot} />}
        {includesWaistcoat(coatVisibleGroup) && <MeasurementGroup title={en.orderForm.waistcoatMeasurements} fields={WAISTCOAT_FIELDS} snapshot={snapshot} />}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      <MeasurementGroup title={en.profile.kameez} fields={KAMEEZ_FIELDS} snapshot={snapshot} />
      <MeasurementGroup
        title={en.profile.shalwar}
        fields={SHALWAR_DECIMAL_FIELDS}
        pocketField={SHALWAR_POCKET_FIELD}
        snapshot={snapshot}
      />
    </div>
  );
}

function MeasurementGroup({
  title,
  fields,
  pocketField,
  snapshot,
}: {
  title: string;
  fields: readonly { key: keyof MeasurementSnapshot; ur: string; label: string }[];
  pocketField?: { key: keyof MeasurementSnapshot; ur: string; label: string };
  snapshot: MeasurementSnapshot;
}) {
  return (
    <div>
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-graphite/40">{title}</h3>
      <dl className="mt-1 space-y-0.5">
        {fields.map((field) => (
          <div key={field.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-baseline gap-1.5">
              <span dir="rtl" className="font-naskh text-graphite">
                {field.ur}
              </span>
            </span>
            <span className="tabular-nums text-graphite">{formatDecimalValue(snapshot[field.key])}</span>
          </div>
        ))}
        {pocketField && (
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span dir="rtl" className="font-naskh text-graphite">
              {pocketField.ur}
            </span>
            <span className="tabular-nums text-graphite">{formatPocketValue(snapshot[pocketField.key])}</span>
          </div>
        )}
      </dl>
    </div>
  );
}

function formatDecimalValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return toFractionDisplay(String(value));
}

function formatPocketValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return value ? en.profile.yes : en.profile.no;
}
