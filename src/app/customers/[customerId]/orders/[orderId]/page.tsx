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
import { DeleteOrderButton } from "@/components/orders/delete-order-button";
import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { toFractionDisplay } from "@/lib/fractions";
import { en } from "@/lib/locale";
import {
  SUIT_TYPE_LABELS,
  COLLAR_TYPE_LABELS,
  BAIN_TYPE_LABELS,
  CUFF_TYPE_LABELS,
  GHERA_TYPE_LABELS,
} from "@/lib/order-options";

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
          <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
            {!isDeleted && (
              <Link
                href={`/customers/${customer.id}/orders/${order.id}/edit`}
                className="rounded-sm border border-rule px-3 py-1.5 text-sm text-graphite transition hover:bg-paper"
              >
                {en.orderForm.editLinkLabel}
              </Link>
            )}
            <Link
              href={`/customers/${customer.id}/orders/${order.id}/receipt`}
              className="rounded-sm border border-rule px-3 py-1.5 text-sm text-graphite transition hover:bg-paper"
            >
              {en.print.receipt.linkLabel}
            </Link>
            <Link
              href={`/customers/${customer.id}/orders/${order.id}/work-order`}
              className="rounded-sm border border-rule px-3 py-1.5 text-sm text-graphite transition hover:bg-paper"
            >
              {en.print.workOrder.linkLabel}
            </Link>
            <Link
              href={`/customers/${customer.id}/orders/${order.id}/whatsapp`}
              className="rounded-sm border border-rule px-3 py-1.5 text-sm text-graphite transition hover:bg-paper"
            >
              {en.whatsapp.linkLabel}
            </Link>
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
          <SectionCard title={order.items.length > 1 ? en.orderDetail.designSelectionsSuit1 : en.orderDetail.designSelections}>
            <dl className="divide-y divide-rule/60 text-sm">
              <Row label={en.orderDetail.suitType} value={SUIT_TYPE_LABELS[order.suitType]} />
              <Row label={en.orderDetail.collar} value={COLLAR_TYPE_LABELS[order.collarType]} />
              <Row label={en.orderDetail.bain} value={BAIN_TYPE_LABELS[order.bainType]} />
              <Row label={en.orderDetail.cuff} value={CUFF_TYPE_LABELS[order.cuffType]} />
              <Row label={en.orderDetail.pocket} value={order.pocketOption?.label ?? "—"} />
              {order.pattiOption && <Row label={en.orderDetail.patti} value={order.pattiOption.label} />}
              <Row label={en.orderDetail.ghera} value={GHERA_TYPE_LABELS[order.gheraType]} />
            </dl>
          </SectionCard>

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
                    {item.suitType && (
                      <dl className="mt-2 divide-y divide-rule/50 rounded-sm border border-rule/60 bg-card px-3 text-sm">
                        <Row label={en.orderDetail.suitType} value={SUIT_TYPE_LABELS[item.suitType]} />
                        <Row label={en.orderDetail.collar} value={COLLAR_TYPE_LABELS[item.collarType!]} />
                        <Row label={en.orderDetail.bain} value={BAIN_TYPE_LABELS[item.bainType!]} />
                        <Row label={en.orderDetail.cuff} value={CUFF_TYPE_LABELS[item.cuffType!]} />
                        <Row label={en.orderDetail.pocket} value={item.pocketOption?.label ?? "—"} />
                        <Row label={en.orderDetail.ghera} value={GHERA_TYPE_LABELS[item.gheraType!]} />
                      </dl>
                    )}
                    {item.measurementSnapshot && (
                      <div className="mt-2">
                        <MeasurementSnapshotGrid snapshot={item.measurementSnapshot} />
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
                <MeasurementSnapshotGrid snapshot={order.defaultMeasurementSnapshot} />
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

function MeasurementSnapshotGrid({ snapshot }: { snapshot: MeasurementSnapshot }) {
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
