import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { en } from "@/lib/locale";

// Legacy internal customer list (Step 3), kept alongside the real S1
// search screen (Step 11) rather than removed — Step 20 restyled it onto
// the Step 10 design system. Data loading, the soft-delete filter, and
// navigation are byte-for-byte unchanged. customerCode is shown here
// deliberately: this list is internal/legacy, not one of the S1-S6
// screens the "never show customerCode" rule applies to.
//
// Step 50 — brought current with the Order Board's own table language
// (bolder uppercase header, indigo-tinted row hover, shadow-sm on the
// table card) instead of the slightly plainer Step 20 styling, so this
// legacy screen doesn't visually stand out as older than the rest of
// the app. Same query, same columns, same "Add New Customer" link,
// same EmptyState.
export default async function CustomersPage() {
  // Soft-deleted customers (deletedAt set) are excluded — they must never
  // appear in the active list.
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      customerCode: true,
      name: true,
      phonePrimary: true,
      createdAt: true,
    },
  });

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.customersList.heading} />

      <PageContainer size="lg">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-graphite">{en.customersList.heading}</h1>
          <Link
            href="/customers/new"
            className="rounded-sm bg-indigo px-4 py-2 text-sm text-white transition hover:bg-indigo-hover"
          >
            {en.customersList.addNew}
          </Link>
        </div>

        {customers.length === 0 ? (
          <div className="mt-6">
            <EmptyState title={en.customersList.emptyTitle} description={en.customersList.emptyDescription} />
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-sm border border-rule bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule bg-paper text-left text-xs font-semibold uppercase tracking-wide text-graphite/60">
                  <th className="px-4 py-2.5">{en.customersList.columns.code}</th>
                  <th className="px-4 py-2.5">{en.customersList.columns.name}</th>
                  <th className="px-4 py-2.5">{en.customersList.columns.phone}</th>
                  <th className="px-4 py-2.5">{en.customersList.columns.created}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-b border-rule/60 transition last:border-b-0 hover:bg-indigo/5">
                    <td className="px-4 py-3">
                      <Link href={`/customers/${customer.id}`} className="font-medium text-indigo hover:underline">
                        {customer.customerCode}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium text-graphite">{customer.name}</td>
                    <td className="px-4 py-3 tabular-nums text-graphite">{customer.phonePrimary}</td>
                    <td className="px-4 py-3 tabular-nums text-graphite/70">{formatDate(customer.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageContainer>
    </main>
  );
}
