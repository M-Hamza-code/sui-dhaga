import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { MeasurementForm } from "@/components/measurement/measurement-form";
import { en } from "@/lib/locale";
import type { Metadata } from "next";

// Page title for the browser tab / history entry (and, on the print
// routes, the browser's own printed page header). The root layout's
// metadata.title template turns this into "Measurement · Sui Dhaga".
export const metadata: Metadata = { title: "Measurement" };

// This ONE route handles both the first measurement (customer.measurement
// is null, form starts empty) and every later edit (form is pre-filled,
// saving overwrites the same row) — there is deliberately no separate
// /measurement/new route.
//
// Phase 6 (offline-first) — the `notFound()` guard for a missing/deleted
// Postgres customer is gone, same reasoning as Phase 5's customer
// edit/profile pages: a customer created offline and not yet synced has
// no Postgres row yet, but MeasurementForm can still find them locally
// (see that component's own mount effect) — see the Phase 6 "Important
// Dependency Rule" analysis for why this is required, not optional. A
// soft-deleted customer still renders the page shell; MeasurementForm
// itself only ever finds a non-deleted local/server row, so editing a
// deleted customer's measurement is not newly enabled by this change.
export default async function MeasurementEditPage({
  params,
  searchParams,
}: {
  params: { customerId: string };
  searchParams: { error?: string };
}) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.customerId },
    include: { measurement: true },
  });

  const customerExists = !!customer && !customer.deletedAt;
  const error = searchParams?.error;
  const heading = customer?.measurement ? en.profile.editMeasurement : en.profile.addMeasurement;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={heading} backHref={`/customers/${params.customerId}`} backLabel="Back to profile" />

      <PageContainer size="lg">
        <h1 className="text-2xl font-semibold capitalize tracking-tight text-graphite">{heading}</h1>
        {customer && <p className="mt-1 text-sm text-graphite/60">{customer.name}</p>}

        <MeasurementForm
          customerId={params.customerId}
          measurement={customer?.measurement ?? null}
          customerExists={customerExists}
          error={error}
        />
      </PageContainer>
    </main>
  );
}
