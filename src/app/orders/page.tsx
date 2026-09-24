import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderBoardTable } from "@/components/orders/order-board-table";
import { getTodayRange } from "@/lib/date-range";
import { en } from "@/lib/locale";

type Tab = "new" | "overdue" | "due-today" | "ready" | "outstanding" | "delivered";
// Step 47 — "outstanding" added as a 4th recognized value so the
// Dashboard's Outstanding stat card has somewhere safe to link to. It is
// deliberately NOT part of the default-tab-selection fallback below (see
// `activeTab`), so visiting /orders with no ?tab= param is unaffected —
// the original 3-way overdue → due-today → ready fallback is unchanged.
//
// Step 50 — "new" and "delivered" added the same way: two more
// recognized ?tab= values, each with its own count/where-clause below,
// neither touching the existing fallback (still only ever
// overdue/due-today/ready — see `activeTab`).
const TABS: Tab[] = ["new", "overdue", "due-today", "ready", "outstanding", "delivered"];

// S4 Order Board (Step 15) — real data, replacing the Step 10 placeholder.
// Three tabs (design brief §8): Due today / Overdue / Ready. Tab state
// lives in the URL (?tab=...), not client state — a plain server-rendered
// page with real <Link> tabs, so it needs no client JS to work and stays
// keyboard/back-button friendly. middleware.ts already blocks
// unauthenticated requests before this ever renders; the null fallback
// below is the same defensive-only guard every other page in the app uses
// (see dashboard/page.tsx).
//
// Step 49 — presentation-only redesign. The ?tab= URL mechanism, the
// four counts, the `where` clause per tab, and the default-tab fallback
// (still only ever overdue/due-today/ready — never outstanding, unchanged
// since Step 47) are byte-for-byte the same. What changed: the tab row is
// now a proper toolbar card sitting flush above the table (instead of a
// bare underline row), each tab's count badge carries a real tone —
// amber for the two attention/financial tabs (Overdue, Outstanding),
// success/green for Ready, neutral for Due Today — matching the same
// color rules the Dashboard's own stat cards already use, and the active
// tab reads more clearly (filled pill, not just an underline).
export default async function OrderBoardPage({ searchParams }: { searchParams: { tab?: string } }) {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const { start: todayStart, end: todayEnd } = getTodayRange();

  // Cheap counts for every tab up front — used both to pick a sensible
  // default tab and to show a count badge on each tab, without fetching
  // full row data for tabs that aren't even showing.
  const [newCount, overdueCount, dueTodayCount, readyCount, outstandingCount, deliveredCount] = await Promise.all([
    // Step 50 — exact same status/database value as everywhere else
    // (order-options.ts's OrderStatus enum) — no new status introduced.
    prisma.order.count({ where: { status: "NEW" } }),
    prisma.order.count({ where: { deliveryDate: { lt: todayStart }, status: { not: "DELIVERED" } } }),
    prisma.order.count({ where: { deliveryDate: { gte: todayStart, lt: todayEnd }, status: { not: "DELIVERED" } } }),
    prisma.order.count({ where: { status: "READY" } }),
    // Step 47 — same where-clause as the Dashboard's own Outstanding
    // aggregate (src/app/overview/page.tsx), so this tab's contents
    // always match what that stat card shows: balance > 0, no status
    // filter.
    prisma.order.count({ where: { balanceAmount: { gt: 0 } } }),
    // Step 50 — same rationale as `newCount`.
    prisma.order.count({ where: { status: "DELIVERED" } }),
  ]);

  const requested = searchParams?.tab;
  const activeTab: Tab = TABS.includes(requested as Tab)
    ? (requested as Tab)
    : // Sensible shop-workflow default (§2): overdue work is the most
      // urgent thing on the counter, then what's due today, then — if
      // nothing is even due — whatever's finished and waiting for pickup.
      // Step 50 — "new" and "delivered" are deliberately NOT part of this
      // fallback chain; visiting /orders with no ?tab= param behaves
      // exactly as it did before these two tabs existed.
      overdueCount > 0
      ? "overdue"
      : dueTodayCount > 0
        ? "due-today"
        : "ready";

  const where =
    activeTab === "new"
      ? { status: "NEW" as const }
      : activeTab === "overdue"
        ? { deliveryDate: { lt: todayStart }, status: { not: "DELIVERED" as const } }
        : activeTab === "due-today"
          ? { deliveryDate: { gte: todayStart, lt: todayEnd }, status: { not: "DELIVERED" as const } }
          : activeTab === "outstanding"
            ? { balanceAmount: { gt: 0 } }
            : activeTab === "delivered"
              ? { status: "DELIVERED" as const }
              : { status: "READY" as const };

  const orders = await prisma.order.findMany({
    where,
    orderBy: { deliveryDate: "asc" },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      deliveryDate: true,
      balanceAmount: true,
      status: true,
      customer: { select: { name: true, phonePrimary: true } },
      _count: { select: { items: true } },
    },
  });

  const emptyTitle =
    activeTab === "new"
      ? en.orderBoard.emptyNewTitle
      : activeTab === "overdue"
        ? en.orderBoard.emptyOverdueTitle
        : activeTab === "due-today"
          ? en.orderBoard.emptyDueTodayTitle
          : activeTab === "outstanding"
            ? en.orderBoard.emptyOutstandingTitle
            : activeTab === "delivered"
              ? en.orderBoard.emptyDeliveredTitle
              : en.orderBoard.emptyReadyTitle;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.nav.orderBoard} />

      <PageContainer size="xl">
        <h1 className="text-xl font-semibold text-graphite">{en.nav.orderBoard}</h1>

        <div className="mt-4 flex flex-wrap gap-1.5 rounded-sm border border-rule bg-card p-1.5 shadow-sm">
          <TabLink tab="new" activeTab={activeTab} label={en.orderBoard.tabNew} count={newCount} tone="neutral" />
          <TabLink tab="overdue" activeTab={activeTab} label={en.search.overdue} count={overdueCount} tone="attention" />
          <TabLink tab="due-today" activeTab={activeTab} label={en.search.dueToday} count={dueTodayCount} tone="neutral" />
          <TabLink tab="ready" activeTab={activeTab} label={en.orderBoard.tabReady} count={readyCount} tone="success" />
          <TabLink tab="outstanding" activeTab={activeTab} label={en.orderBoard.tabOutstanding} count={outstandingCount} tone="attention" />
          <TabLink tab="delivered" activeTab={activeTab} label={en.orderBoard.tabDelivered} count={deliveredCount} tone="success" />
        </div>

        <div className="mt-4">
          {orders.length === 0 ? (
            <EmptyState title={emptyTitle} description={en.orderBoard.emptyHint} />
          ) : (
            <OrderBoardTable orders={orders} todayStart={todayStart} redirectTo={`/orders?tab=${activeTab}`} />
          )}
        </div>
      </PageContainer>
    </main>
  );
}

// Step 49 — `tone` replaces the old boolean `attention` flag with the
// three tone meanings actually in play across the board's four tabs:
// "attention" (amber — Overdue, Outstanding: both financial/schedule
// warnings), "success" (green — Ready: genuinely positive, ready for
// pickup), and "neutral" (Due Today: informational, not yet a concern).
// This only changes each badge's color; it never touches which tab is
// "active" or what `?tab=` value a click navigates to.
function TabLink({
  tab,
  activeTab,
  label,
  count,
  tone = "neutral",
}: {
  tab: Tab;
  activeTab: Tab;
  label: string;
  count: number;
  tone?: "neutral" | "attention" | "success";
}) {
  const isActive = tab === activeTab;
  const badgeTone =
    count === 0
      ? "bg-paper text-graphite/40"
      : tone === "attention"
        ? "bg-amber/15 text-amber"
        : tone === "success"
          ? "bg-success/15 text-success"
          : "bg-paper text-graphite/60";
  return (
    <Link
      href={`/orders?tab=${tab}`}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center gap-2 rounded-sm px-3.5 py-1.5 text-sm font-medium transition ${
        isActive ? "bg-indigo text-white" : "text-graphite/70 hover:bg-paper hover:text-ink"
      }`}
    >
      {label}
      <span
        className={`tabular-nums rounded-full px-1.5 py-0.5 text-xs ${isActive ? "bg-white/20 text-white" : badgeTone}`}
      >
        {count}
      </span>
    </Link>
  );
}
