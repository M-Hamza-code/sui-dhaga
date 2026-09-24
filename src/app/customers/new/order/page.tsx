import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { OrderForm } from "@/components/orders/order-form";
import { parseDefaultPrices } from "@/lib/shop-settings";
import { en } from "@/lib/locale";

// Step 25 — the authoritative fast flow: Dashboard "New customer" opens
// this page directly (no separate /customers/new detour first). Reuses
// OrderForm's existing mode="new" support (no second order-form
// component) and the same DesignOption/ShopSettings loading
// orders/new/page.tsx already does for an existing customer — there is
// simply no customer to fetch here yet, since one doesn't exist.
//
// /customers/new (Step 3) is unchanged and still reachable as a manual,
// order-less customer-creation path — this route does not replace it.
export default async function NewCustomerOrderPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [pocketOptions, pattiOptions, shopSettings] = await Promise.all([
    prisma.designOption.findMany({
      where: { category: "POCKET", isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.designOption.findMany({
      where: { category: "PATTI", isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.shopSettings.findUnique({ where: { singleton: true } }),
  ]);

  const error = searchParams?.error;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.orderForm.newCustomerHeading} backHref="/dashboard" backLabel={en.nav.search} />

      <PageContainer size="lg">
        <h1 className="text-xl font-semibold text-graphite">{en.orderForm.newCustomerHeading}</h1>

        <OrderForm
          mode="new"
          measurement={null}
          pocketOptions={pocketOptions}
          pattiOptions={pattiOptions}
          error={error}
          defaultAdvancePercent={shopSettings?.defaultAdvancePercent?.toString() ?? null}
          defaultPrices={parseDefaultPrices(shopSettings?.defaultPrices)}
        />
      </PageContainer>
    </main>
  );
}
