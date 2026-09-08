import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { prisma } from "@/lib/prisma";
import { EditCustomerForm } from "@/components/customers/edit-customer-form";
import { en } from "@/lib/locale";

// customerCode, createdAt, and every id are shown as read-only context
// only — none of them are inputs on this form, so there is no way to
// submit a change to them.
//
// Phase 5 (offline-first) — the form itself now lives in
// EditCustomerForm (a client component, local-first — see that file's
// own comment for exactly how). This page's job narrows to: read
// whatever Postgres currently has for this id (which may be nothing yet,
// for a customer created offline and not yet synced) and hand it to the
// form as a starting point; EditCustomerForm itself then checks the
// local Dexie mirror and prefers ITS values if a local row exists,
// because a pending local edit is always newer than the last server
// read ("local storage is the source of truth"). This is why the old
// `if (!customer) notFound()` guard is gone — a missing Postgres row is
// no longer necessarily a real 404, only EditCustomerForm can tell (by
// also checking Dexie) whether this id truly doesn't exist anywhere.
// updateCustomer (customer-actions.ts) itself is untouched and still
// fully working.
export default async function EditCustomerPage({ params }: { params: { customerId: string } }) {
  const customer = await prisma.customer.findUnique({ where: { id: params.customerId } });
  const serverCustomer =
    customer && !customer.deletedAt
      ? {
          name: customer.name,
          phonePrimary: customer.phonePrimary,
          phoneSecondary: customer.phoneSecondary ?? "",
          address: customer.address ?? "",
          customerCode: customer.customerCode,
        }
      : null;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.customerForm.editHeading} backHref={`/customers/${params.customerId}`} backLabel="Back to profile" />

      <PageContainer size="sm">
        <h1 className="text-xl font-semibold text-graphite">{en.customerForm.editHeading}</h1>
        <EditCustomerForm customerId={params.customerId} serverCustomer={serverCustomer} />
      </PageContainer>
    </main>
  );
}
