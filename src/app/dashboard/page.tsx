import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SearchHome } from "@/components/search/search-home";
import type { CustomerSearchResult } from "@/lib/customer-search-query";
import { getTodayRange } from "@/lib/date-range";
import { en } from "@/lib/locale";
import type { Metadata } from "next";

// Page title for the browser tab / history entry (and, on the print
// routes, the browser's own printed page header). The root layout's
// metadata.title template turns this into "Customers · Sui Dhaga".
export const metadata: Metadata = { title: "Customers" };

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

  const [dueTodayCount, overdueCount, outstandingResult, allCustomersRaw] = await Promise.all([
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
    // Every active customer, A→Z — the idle content for the space below
    // the search field.
    //
    // This replaces the old "All Orders" list that used to fill the same
    // space. That list made this one screen show ORDERS while idle and
    // CUSTOMERS once you typed, so the thing you were looking at changed
    // kind the moment you started searching. Searching here searches
    // customers (by name, phone, or customer ID), and the nav calls this
    // screen "Customers" — so the idle list is customers too, and typing
    // now simply narrows the list already on screen.
    //
    // The all-orders view was not dropped: it moved to the Order Board's
    // own new "All" tab (src/app/orders/page.tsx), where orders live.
    //
    // Selected fields are exactly CustomerSearchResult's (see
    // customer-search-query.ts) so the idle rows and the search-result
    // rows can be rendered by one shared component rather than two that
    // drift apart.
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        customerCode: true,
        phonePrimary: true,
        orders: { select: { orderDate: true }, orderBy: { orderDate: "desc" }, take: 1 },
        _count: { select: { orders: true } },
        measurement: { select: { updatedAt: true } },
      },
    }),
  ]);

  const outstandingTotal = outstandingResult._sum.balanceAmount ?? 0;

  // Shaped into exactly CustomerSearchResult — the same objects
  // useCustomerSearch hands SearchHome for a real search — so the idle
  // list and the search results are rendered by the same row component
  // and can't drift apart. No Decimal is involved here (unlike the old
  // all-orders mapping, which had to stringify balanceAmount), and Date
  // is a valid Client Component prop, so these pass through as-is.
  const allCustomers: CustomerSearchResult[] = allCustomersRaw.map((customer) => ({
    id: customer.id,
    name: customer.name,
    customerCode: customer.customerCode,
    phonePrimary: customer.phonePrimary,
    orderCount: customer._count.orders,
    lastOrderAt: customer.orders[0]?.orderDate ?? null,
    measurementUpdatedAt: customer.measurement?.updatedAt ?? null,
  }));

  return (
    <main className="flex min-h-screen flex-col">
      {/* S1 has its own large search field as the page body — the header's
          compact search dropdown would just be a confusing second search
          box on this one screen, so it's hidden here only. */}
      <PageHeader title="Search" hideSearch />

      <div className="flex-1">
        <SearchHome allCustomers={allCustomers} />
      </div>

      {/* These are the same three numbers the Dashboard's own stat cards
          show (/overview), computed from the same where-clauses — but
          there they're links into the matching Order Board view and here
          they were dead text, so the obvious "which orders are those?"
          click did nothing on the screen the admin actually lands on.
          Each cell now points at the exact `?tab=` view whose own
          where-clause matches the number above it, the same destinations
          StatCard already uses. No query, no number, and no layout
          changed. */}
      <div className="flex border-t border-rule bg-card">
        <BottomStripCell label={en.search.dueToday} value={dueTodayCount} href="/orders?tab=due-today" />
        <BottomStripCell label={en.search.overdue} value={overdueCount} attention href="/orders?tab=overdue" />
        <BottomStripCell
          label={en.search.outstanding}
          value={formatMoney(outstandingTotal)}
          attention
          href="/orders?tab=outstanding"
        />
      </div>
    </main>
  );
}

// `href` makes the whole cell one real <Link> — same structure StatCard
// already uses for the identical stats on /overview, rather than a
// nested interactive element. The visual treatment is unchanged apart
// from a hover tint and a focus ring, both the same ones used elsewhere
// in the app.
function BottomStripCell({
  label,
  value,
  attention = false,
  href,
}: {
  label: string;
  value: number | string;
  attention?: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col items-center justify-center gap-0.5 border-l border-rule px-3 py-3 text-center transition first:border-l-0 hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo sm:flex-row sm:items-baseline sm:gap-2 sm:px-6"
    >
      <span className="text-xs text-graphite/60 sm:text-sm">{label}</span>
      <span className={`whitespace-nowrap tabular-nums text-xl font-semibold ${attention ? "text-amber" : "text-graphite"}`}>
        {value}
      </span>
    </Link>
  );
}
