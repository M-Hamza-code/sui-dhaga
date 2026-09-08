import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
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

  const [dueTodayCount, overdueCount, outstandingResult] = await Promise.all([
    // Due today: delivery date is today, not yet delivered.
    prisma.order.count({
      where: { deliveryDate: { gte: todayStart, lt: todayEnd }, status: { not: "DELIVERED" } },
    }),
    // Overdue: delivery date already passed, still not delivered.
    prisma.order.count({
      where: { deliveryDate: { lt: todayStart }, status: { not: "DELIVERED" } },
    }),
    // Outstanding: total money still owed across every order with a
    // remaining balance, regardless of status — a delivered order can
    // still be unpaid.
    prisma.order.aggregate({
      where: { balanceAmount: { gt: 0 } },
      _sum: { balanceAmount: true },
    }),
  ]);

  const outstandingTotal = outstandingResult._sum.balanceAmount ?? 0;

  return (
    <main className="flex min-h-screen flex-col">
      {/* S1 has its own large search field as the page body — the header's
          compact search dropdown would just be a confusing second search
          box on this one screen, so it's hidden here only. */}
      <PageHeader title="Search" hideSearch />

      <div className="flex-1">
        <SearchHome />
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
