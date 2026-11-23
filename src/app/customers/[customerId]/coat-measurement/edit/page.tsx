import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { CoatMeasurementForm } from "@/components/measurement/coat-measurement-form";
import { en } from "@/lib/locale";
import type { Metadata } from "next";

// Page title for the browser tab / history entry.
export const metadata: Metadata = { title: "Coat Measurement" };

// Standalone Prince Coat/Waistcoat measurement edit page — the Coat-mode
// sibling of /customers/[customerId]/measurement/edit (see that page's
// own comment). One route handles both the first Coat measurement
// (customer.coatMeasurement is null) and every later edit.
export default async function CoatMeasurementEditPage({
  params,
  searchParams,
}: {
  params: { customerId: string };
  searchParams: { error?: string };
}) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.customerId },
    include: { coatMeasurement: true },
  });

  const customerExists = !!customer && !customer.deletedAt;
  const error = searchParams?.error;
  const heading = customer?.coatMeasurement ? en.profile.editCoatMeasurement : en.profile.addCoatMeasurement;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={heading} backHref={`/customers/${params.customerId}`} backLabel="Back to profile" />

      <PageContainer size="lg">
        <h1 className="text-2xl font-semibold capitalize tracking-tight text-graphite">{heading}</h1>
        {customer && <p className="mt-1 text-sm text-graphite/60">{customer.name}</p>}

        <CoatMeasurementForm
          customerId={params.customerId}
          measurement={customer?.coatMeasurement ?? null}
          customerExists={customerExists}
          error={error}
        />
      </PageContainer>
    </main>
  );
}
