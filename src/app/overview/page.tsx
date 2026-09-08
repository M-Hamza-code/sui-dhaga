import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney, formatOrderNumber, formatRelativeTime } from "@/lib/format";
import { getTodayRange } from "@/lib/date-range";
import { en } from "@/lib/locale";

// Step 46 — the real Dashboard, replacing the Step 45 placeholder.
// /dashboard remains S1 Search/Home, completely untouched, at its own
// URL — this is a separate screen.
//
// Every number here is a real, existing Prisma query — the same
// where-clauses dashboard's old bottom-strip logic and the Order
// Board's own tab counts already use (copied, not imported, per the
// "smallest safe change" rule: neither of those working files is
// touched to extract a shared helper). No schema change, no new
// business logic, nothing fabricated.
//
// Recent Orders is the deliberate fix for the Step 43 finding: a
// freshly-created order (status NEW, delivery date ~7 days out) doesn't
// satisfy any of the Order Board's three tabs by design — this section
// shows every recent order regardless of status/date, newest first, so
// it's immediately findable right after being saved.
export default async function OverviewPage() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const { start: todayStart, end: todayEnd } = getTodayRange();

  const [dueTodayCount, overdueCount, readyCount, outstandingResult, shopSettings, recentOrders, recentCustomers] =
    await Promise.all([
      // Same where-clause as dashboard/page.tsx's existing bottom strip.
      prisma.order.count({
        where: { deliveryDate: { gte: todayStart, lt: todayEnd }, status: { not: "DELIVERED" } },
      }),
      // Same where-clause as dashboard/page.tsx's existing bottom strip.
      prisma.order.count({
        where: { deliveryDate: { lt: todayStart }, status: { not: "DELIVERED" } },
      }),
      // Same where-clause as the Order Board's own Ready tab count.
      prisma.order.count({ where: { status: "READY" } }),
      // Same where-clause as dashboard/page.tsx's existing bottom strip.
      prisma.order.aggregate({
        where: { balanceAmount: { gt: 0 } },
        _sum: { balanceAmount: true },
      }),
      prisma.shopSettings.findUnique({ where: { singleton: true } }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          status: true,
          deliveryDate: true,
          balanceAmount: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.customer.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, name: true, phonePrimary: true, createdAt: true },
      }),
    ]);

  const outstandingTotal = outstandingResult._sum.balanceAmount ?? 0;
  const shopName = shopSettings?.name || en.app.name;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.dashboard.heading} />

      <PageContainer size="xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-graphite">
            {en.dashboard.welcomeTemplate.replace("{shop}", shopName)}
          </h1>
          <span className="tabular-nums text-sm text-graphite/50">{formatDate(new Date())}</span>
        </div>

        {/* Stats — same four numbers already shown on S1's bottom strip
            (Due today/Overdue/Outstanding) plus Ready (Order Board's own
            count), just given real visual presence here.
            Step 47 — each card now links to its corresponding Order Board
            view via the board's existing `?tab=` mechanism. Outstanding
            links to a new `outstanding` tab added to the Order Board in
            this same step (see src/app/orders/page.tsx), scoped with the
            exact same balanceAmount > 0 filter this card's own number
            already uses — so the destination always matches what's shown
            here. */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={en.search.dueToday} value={dueTodayCount} href="/orders?tab=due-today" />
          <StatCard
            label={en.search.overdue}
            value={overdueCount}
            tone={overdueCount > 0 ? "attention" : "neutral"}
            href="/orders?tab=overdue"
          />
          <StatCard
            label={en.search.outstanding}
            value={formatMoney(outstandingTotal)}
            tone={Number(outstandingTotal) > 0 ? "attention" : "neutral"}
            href="/orders?tab=outstanding"
          />
          <StatCard
            label={en.orderBoard.tabReady}
            value={readyCount}
            tone={readyCount > 0 ? "positive" : "neutral"}
            href="/orders?tab=ready"
          />
        </div>

        {/* Quick Actions — links only, every target is an existing,
            unchanged route/flow. No new forms, no new logic. */}
        <div className="mt-6">
          <SectionCard title={en.dashboard.quickActions}>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/customers/new/order"
                className="rounded-sm bg-indigo px-4 py-2 text-sm text-white transition hover:bg-indigo-hover"
              >
                {en.search.newCustomer}
              </Link>
              <Link
                href="/customers/new"
                className="rounded-sm border border-rule px-4 py-2 text-sm text-graphite transition hover:bg-paper"
              >
                {en.search.newCustomerOnly}
              </Link>
              <Link
                href="/dashboard"
                className="rounded-sm border border-rule px-4 py-2 text-sm text-graphite transition hover:bg-paper"
              >
                {en.dashboard.quickActionSearch}
              </Link>
            </div>
          </SectionCard>
        </div>

        {/* Recent activity — two columns, matching S2's own established
            "wider list + narrower list" grid convention. */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <SectionCard
            title={en.dashboard.recentOrders}
            action={
              <Link href="/orders" className="text-xs font-medium text-indigo hover:underline">
                {en.dashboard.viewOrderBoard}
              </Link>
            }
          >
            {recentOrders.length === 0 ? (
              <p className="text-sm text-graphite/50">{en.dashboard.recentOrdersEmpty}</p>
            ) : (
              <ul className="divide-y divide-rule/60">
                {recentOrders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/customers/${order.customerId}/orders/${order.id}`}
                      className="flex items-center gap-3 py-2.5 text-sm transition hover:bg-paper"
                    >
                      <span className="w-12 flex-none tabular-nums font-semibold text-ink">
                        {formatOrderNumber(order.orderNumber)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-graphite">{order.customer.name}</span>
                      <span className="flex-none tabular-nums text-graphite/60">
                        {order.deliveryDate ? formatDate(order.deliveryDate) : "—"}
                      </span>
                      <span
                        className={`w-24 flex-none text-right tabular-nums ${
                          Number(order.balanceAmount) > 0 ? "text-amber" : "text-graphite/40"
                        }`}
                      >
                        {Number(order.balanceAmount) > 0 ? formatMoney(order.balanceAmount) : en.dashboard.noBalance}
                      </span>
                      <span className="flex-none">
                        <StatusBadge status={order.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title={en.dashboard.recentCustomers}>
            {recentCustomers.length === 0 ? (
              <p className="text-sm text-graphite/50">{en.dashboard.recentCustomersEmpty}</p>
            ) : (
              <ul className="divide-y divide-rule/60">
                {recentCustomers.map((customer) => (
                  <li key={customer.id}>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="block py-2.5 text-sm transition hover:bg-paper"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-medium text-graphite">{customer.name}</span>
                        <span className="flex-none text-xs text-graphite/50">{formatRelativeTime(customer.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 block tabular-nums text-xs text-graphite/60">{customer.phonePrimary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </PageContainer>
    </main>
  );
}
