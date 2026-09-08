import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { NewCustomerForm } from "@/components/customers/new-customer-form";
import { en } from "@/lib/locale";

// customerCode is intentionally not a field on this form anywhere — it is
// generated server-side and cannot be supplied by the admin. This is
// S1's "Customer only" action (Step 32) — reached from /dashboard, not
// from the legacy /customers list, so its own back link goes back to S1
// Search/Home rather than that list.
//
// Phase 5 (offline-first) — the form itself now lives in
// NewCustomerForm (a client component, local-first: writes to Dexie +
// the sync queue instead of submitting to the createCustomer Server
// Action directly — see that component's own comment). This page stays
// a thin Server Component: just PageHeader/heading/PageContainer,
// unchanged from before. createCustomer (customer-actions.ts) itself is
// untouched and still fully working.
export default function NewCustomerPage() {
  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.customerForm.newHeading} backHref="/dashboard" backLabel={en.printPreview.backToSearch} />

      <PageContainer size="sm">
        <h1 className="text-xl font-semibold text-graphite">{en.customerForm.newHeading}</h1>
        <NewCustomerForm />
      </PageContainer>
    </main>
  );
}
