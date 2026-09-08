import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { OrderForm } from "@/components/orders/order-form";
import { parseDefaultPrices } from "@/lib/shop-settings";
import { getLatestMeasurementForPrefill } from "@/lib/measurement-prefill";
import { en } from "@/lib/locale";

// Phase 6 (offline-first) — the `notFound()` guard for a missing/
// deleted Postgres customer is gone, same reasoning as Phase 5's
// customer pages and this same phase's measurement-edit page: a
// customer created offline and not yet synced has no Postgres row yet,
// but OrderForm can still find them locally (see that component's own
// mount effect) — required by the Phase 6 "Important Dependency Rule"
// scenario (creating an order for a customer that's itself still
// pending its own sync). A soft-deleted customer still renders the page
// shell; OrderForm only ever finds a non-deleted local/server row.
export default async function NewOrderPage({
  params,
  searchParams,
}: {
  params: { customerId: string };
  searchParams: { error?: string };
}) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.customerId },
  });
  const customerExists = !!customer && !customer.deletedAt;

  // Step 28: prefill now comes from getLatestMeasurementForPrefill, not
  // the raw customer.measurement relation — see that function's own
  // comment for why. Queried by id regardless of whether `customer`
  // itself was found — an offline-created, not-yet-synced customer
  // simply has no server-side measurement to prefill from yet, same as
  // any other genuinely brand-new synced customer.
  const [prefillMeasurement, pocketOptions, shopSettings] = await Promise.all([
    getLatestMeasurementForPrefill(params.customerId),
    prisma.designOption.findMany({
      where: { category: "POCKET", isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.shopSettings.findUnique({ where: { singleton: true } }),
  ]);

  const error = searchParams?.error;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title="Add Order" backHref={`/customers/${params.customerId}`} backLabel="Back to profile" />

      <PageContainer size="lg">
        <h1 className="text-xl font-semibold text-graphite">{en.orderForm.heading}</h1>
        {customer && <p className="mt-1 text-sm text-graphite/60">{customer.name}</p>}

        <OrderForm
          customerId={params.customerId}
          customerExists={customerExists}
          measurement={prefillMeasurement}
          pocketOptions={pocketOptions}
          error={error}
          defaultAdvancePercent={shopSettings?.defaultAdvancePercent?.toString() ?? null}
          defaultPrices={parseDefaultPrices(shopSettings?.defaultPrices)}
        />
      </PageContainer>
    </main>
  );
}
