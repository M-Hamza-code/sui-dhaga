import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { formatMoney, formatDate, formatOrderNumber } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SearchHome } from "@/components/search/search-home";
import { getTodayRange } from "@/lib/date-range";
import { en } from "@/lib/locale";

// S1 Search/Home (Step 11). This is still the /dashboard route — the old
// Step 7 stat-card dashboard content is fully replaced here, but the URL
// itself is left unchanged on purpose: PageHeader's brand mark and
// "Search" nav link, the login redirect, and any existing bookmarks all
// already point at /dashboard, so nothing outside this file needed to
// change for S1 to become the real landing screen. "The existing
// dashboard was only a transitional screen" (Step 11 brief) — this is
// that transition.
//
// middleware.ts already redirects unauthenticated requests to /login
// before this component ever renders; the null fallback below is just a
// defensive guard, not the actual protection mechanism.
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const { start: todayStart, end: todayEnd } = getTodayRange();

  const [dueTodayCount, overdueCount, outstandingResult, allOrdersRaw] = await Promise.all([
    // Due today: delivery date is today, not yet delivered.
    prisma.order.count({
      where: { deliveryDate: { gte: todayStart, lt: todayEnd }, status: { not: "DELIVERED" } },
    }),
    // Overdue: delivery date already passed, still not delivered.
    prisma.order.count({
      where: { deliveryDate: { lt: todayStart }, status: { not: "DELIVERED" } },
    }),
    // Outstanding: total money still owed across every order with a
    // remaining balance. Step 63 — once an order is Delivered, its
    // balance is excluded from this total (the order's own totalAmount/
    // advanceAmount/balanceAmount rows are never touched — only this
    // calculation's own where-clause changed).
    prisma.order.aggregate({
      where: { balanceAmount: { gt: 0 }, status: { not: "DELIVERED" } },
      _sum: { balanceAmount: true },
    }),
    // All orders (every one, not just recent — the S1 "empty space below
    // search" fill), sorted primarily by the CUSTOMER's own name (A→Z,
    // case-insensitive) so every order belonging to the same customer
    // naturally lands adjacent to each other under that customer's
    // alphabetical position — a plain single-key sort already groups
    // them, no separate grouping step needed. Most-recent-first is only
    // the tiebreaker within one customer's own orders.
    prisma.order.findMany({
      orderBy: [{ customer: { name: "asc" } }, { createdAt: "desc" }],
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
  ]);

  const outstandingTotal = outstandingResult._sum.balanceAmount ?? 0;

  // Step 59 — formatted server-side into plain strings/booleans before
  // crossing into the client SearchHome component: a Prisma Decimal
  // (balanceAmount) isn't itself serializable as a Client Component prop
  // the way a plain Date is, matching the same "format first, pass
  // strings down" rule OrderEditData already follows (order-form.tsx).
  const allOrders = allOrdersRaw.map((order) => ({
    id: order.id,
    orderNumberDisplay: formatOrderNumber(order.orderNumber),
    customerId: order.customerId,
    customerName: order.customer.name,
    status: order.status,
    deliveryDateDisplay: order.deliveryDate ? formatDate(order.deliveryDate) : "—",
    hasBalance: Number(order.balanceAmount) > 0,
    balanceDisplay: Number(order.balanceAmount) > 0 ? formatMoney(order.balanceAmount) : en.dashboard.noBalance,
  }));

  return (
    <main className="flex min-h-screen flex-col">
      {/* S1 has its own large search field as the page body — the header's
          compact search dropdown would just be a confusing second search
          box on this one screen, so it's hidden here only. */}
      <PageHeader title="Search" hideSearch />

      <div className="flex-1">
        <SearchHome allOrders={allOrders} />
      </div>

      <div className="flex border-t border-rule bg-card">
        <BottomStripCell label={en.search.dueToday} value={dueTodayCount} />
        <BottomStripCell label={en.search.overdue} value={overdueCount} attention />
        <BottomStripCell label={en.search.outstanding} value={formatMoney(outstandingTotal)} attention />
      </div>
    </main>
  );
}

function BottomStripCell({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: number | string;
  attention?: boolean;
}) {
  return (
    <div className="flex flex-1 items-baseline justify-center gap-2 border-l border-rule px-6 py-3 first:border-l-0">
      <span className="text-sm text-graphite/60">{label}</span>
      <span className={`tabular-nums text-xl font-semibold ${attention ? "text-amber" : "text-graphite"}`}>
        {value}
      </span>
    </div>
  );
}
