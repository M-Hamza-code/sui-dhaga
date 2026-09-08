import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatOrderNumber, formatRelativeTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { SectionCard } from "@/components/ui/section-card";
import { deleteCustomer } from "@/lib/customer-actions";
import { CustomerIdentityCard } from "@/components/customers/customer-identity-card";
import { PendingOrdersNotice } from "@/components/customers/pending-orders-notice";
import { OrderHistoryStatus } from "@/components/customers/order-history-status";
import { MeasurementSyncBadge } from "@/components/customers/measurement-sync-badge";
import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { toFractionDisplay } from "@/lib/fractions";
import { en } from "@/lib/locale";
import type { Measurement } from "@prisma/client";

// S2 Customer Profile (Step 12). customerCode (SD-######) is deliberately
// never read into this page's queries, let alone rendered — the
// authoritative design files never show it. It stays in the database,
// untouched, and is still shown on the legacy /customers list + edit
// pages (Step 3), which this step does not remove.
//
// Step 48 redesigned the identity header into one bordered card, and
// Order History/Saved Measurements into shared SectionCards with a real
// <table> for order history — all of that below is unchanged.
//
// Phase 5 (offline-first) — the identity header itself now delegates to
// CustomerIdentityCard (a client component), which additionally checks
// the local Dexie mirror and prefers its values when present ("local
// storage is the source of truth" — see that component's own comment).
// This is also why the old `if (!customer) notFound()` guard is gone:
// a customer created offline and not yet synced has no Postgres row
// yet, but CustomerIdentityCard can still find it locally. Order History
// and Saved Measurements below are otherwise untouched — for a missing
// Postgres customer they simply default to the same empty states a
// genuinely brand-new synced customer would also show.
//
// Phase 6 (offline-first) added one line inside the Order History card:
// <PendingOrdersNotice>, which separately lists any locally-created,
// not-yet-synced order for this customer (the server-rendered <table>
// below it is completely untouched).
//
// Phase 7 added one line inside the Saved Measurements card:
// <MeasurementSyncBadge>, a small text tag reading the local Dexie
// mirror's sync state — see that component's own comment.
export default async function CustomerProfilePage({
  params,
}: {
  params: { customerId: string };
}) {
  // Fetched without a deletedAt filter: a direct link to a since-deleted
  // customer should show their (reserved) record rather than a bare 404 —
  // they just lose the mutating actions. A completely unknown id no
  // longer 404s here either (Phase 5) — CustomerIdentityCard itself
  // decides whether it exists locally instead.
  const customer = await prisma.customer.findUnique({
    where: { id: params.customerId },
    include: {
      measurement: true,
      orders: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { items: true } } },
      },
    },
  });

  const isDeleted = customer?.deletedAt != null;
  const orders = customer?.orders ?? [];
  const measurement = customer?.measurement ?? null;
  const lastOrder = orders[0];
  const orderMeta =
    orders.length === 0
      ? en.search.noOrders
      : `${orders.length === 1 ? en.search.oneOrder : en.search.orderCountTemplate.replace("{count}", String(orders.length))} · last ${formatRelativeTime(lastOrder.createdAt)}`;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title="Customer Profile" backHref="/dashboard" backLabel="Back to search" />

      <PageContainer size="xl">
        {isDeleted && (
          <div className="mb-4 rounded-sm border border-amber bg-amber/10 px-4 py-2 text-sm text-graphite">
            {en.profile.deletedNotice}
          </div>
        )}

        <CustomerIdentityCard
          customerId={params.customerId}
          serverCustomer={
            customer
              ? { name: customer.name, phonePrimary: customer.phonePrimary, customerCode: customer.customerCode, isDeleted, orderMeta }
              : null
          }
          deleteAction={deleteCustomer.bind(null, params.customerId)}
        />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          {/* Order history — primary column */}
          <SectionCard title={en.profile.orderHistory}>
            <PendingOrdersNotice customerId={params.customerId} knownOrderIds={orders.map((o) => o.id)} />
            {orders.length === 0 ? (
              <p className="rounded-sm border border-dashed border-rule bg-paper p-4 text-sm text-graphite/60">
                {en.profile.noOrdersYet}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-rule">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-paper text-left text-xs font-medium uppercase tracking-wide text-graphite/60">
                      <th className="px-3 py-2 pl-4 font-medium">{en.profile.orderColumns.order}</th>
                      <th className="px-3 py-2 font-medium">{en.profile.orderColumns.date}</th>
                      <th className="px-3 py-2 font-medium">{en.profile.orderColumns.delivery}</th>
                      <th className="px-3 py-2 text-right font-medium">{en.profile.orderColumns.suits}</th>
                      <th className="px-3 py-2 text-right font-medium">{en.profile.orderColumns.total}</th>
                      <th className="px-3 py-2 text-right font-medium">{en.profile.orderColumns.balance}</th>
                      <th className="px-3 py-2 pr-4 font-medium">{en.profile.orderColumns.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const href = `/customers/${params.customerId}/orders/${order.id}`;
                      return (
                        <tr key={order.id} className="border-b border-rule/60 last:border-b-0 hover:bg-paper">
                          <td className="p-0">
                            <Link href={href} className="block px-3 py-2.5 pl-4 tabular-nums font-semibold text-ink">
                              {formatOrderNumber(order.orderNumber)}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link href={href} className="block px-3 py-2.5 tabular-nums text-graphite/70">
                              {formatDate(order.orderDate)}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link href={href} className="block px-3 py-2.5 tabular-nums text-graphite/70">
                              {order.deliveryDate ? formatDate(order.deliveryDate) : "—"}
                            </Link>
                          </td>
                          {/* Orders created before per-suit OrderItem tracking
                              was wired into order creation have no items rows
                              yet — every order is at least 1 physical suit,
                              so that case falls back to 1 rather than 0. */}
                          <td className="p-0">
                            <Link href={href} className="block px-3 py-2.5 text-right tabular-nums text-graphite">
                              {Math.max(1, order._count.items)}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link href={href} className="block px-3 py-2.5 text-right tabular-nums text-graphite">
                              {formatMoney(order.totalAmount)}
                            </Link>
                          </td>
                          <td className="p-0">
                            <Link
                              href={href}
                              className={`block px-3 py-2.5 text-right tabular-nums ${Number(order.balanceAmount) > 0 ? "text-amber" : "text-graphite/40"}`}
                            >
                              {formatMoney(order.balanceAmount)}
                            </Link>
                          </td>
                          <td className="px-3 py-2 pr-4">
                            {/* Phase 11 (§2/§4) — reconciles a locally-
                                pending status change (Order Detail's
                                OrderStatusForm) that hasn't synced yet;
                                see that component's own comment. */}
                            <OrderHistoryStatus orderId={order.id} serverStatus={order.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Saved measurements — secondary column */}
          <SectionCard
            title={en.profile.savedMeasurements}
            action={
              !isDeleted ? (
                <Link href={`/customers/${params.customerId}/measurement/edit`} className="text-sm text-indigo hover:underline">
                  {measurement ? en.profile.editMeasurement : en.profile.addMeasurement}
                </Link>
              ) : undefined
            }
          >
            <div className="-mt-1 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {measurement && (
                <p className="text-xs text-graphite/50">
                  {en.profile.measurementAgeTemplate.replace("{age}", formatRelativeTime(measurement.updatedAt))}
                </p>
              )}
              {/* Phase 7 (Part D) — reads the local Dexie mirror only;
                  renders nothing if there's no local row to report on
                  (e.g. a synced measurement never touched locally this
                  session — the age line above already covers that case). */}
              <MeasurementSyncBadge customerId={params.customerId} />
            </div>

            {!measurement ? (
              <p className="rounded-sm border border-dashed border-rule bg-paper p-4 text-sm text-graphite/60">
                {en.profile.noMeasurementYet}
              </p>
            ) : (
              <div className="space-y-4">
                <MeasurementGroup title={en.profile.kameez} measurement={measurement} decimalFields={KAMEEZ_FIELDS} />
                <MeasurementGroup
                  title={en.profile.shalwar}
                  measurement={measurement}
                  decimalFields={SHALWAR_DECIMAL_FIELDS}
                  pocketField={SHALWAR_POCKET_FIELD}
                />

                {measurement.note && (
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wide text-graphite/60">{en.profile.note}</h3>
                    <p className="mt-1 rounded-sm border border-rule bg-paper p-3 text-sm text-graphite">
                      {measurement.note}
                    </p>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      </PageContainer>
    </main>
  );
}

function MeasurementGroup({
  title,
  measurement,
  decimalFields,
  pocketField,
}: {
  title: string;
  measurement: Measurement;
  decimalFields: readonly { key: keyof Measurement; ur: string; label: string }[];
  pocketField?: { key: keyof Measurement; ur: string; label: string };
}) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-graphite/60">{title}</h3>
      <dl className="mt-1 divide-y divide-rule/40 rounded-sm border border-rule bg-paper">
        {decimalFields.map((field) => (
          <MeasurementRow key={field.key} ur={field.ur} label={field.label} value={formatDecimalValue(measurement[field.key])} />
        ))}
        {pocketField && (
          <MeasurementRow
            key={pocketField.key}
            ur={pocketField.ur}
            label={pocketField.label}
            value={formatPocketValue(measurement[pocketField.key])}
          />
        )}
      </dl>
    </div>
  );
}

function MeasurementRow({ ur, label, value }: { ur: string; label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="flex items-baseline gap-2">
        <span dir="rtl" className="font-naskh text-base text-graphite">
          {ur}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-graphite/40">{label}</span>
      </span>
      <span className="tabular-nums text-graphite">{value}</span>
    </div>
  );
}

function formatDecimalValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  // Step 13: never show raw decimal notation (45.50/45.25/45.75) — the
  // same fraction-glyph formatter the measurement edit form uses.
  return toFractionDisplay(String(value));
}

function formatPocketValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return value ? en.profile.yes : en.profile.no;
}
