"use server";

// Global customer search (Step 11 — replaces the Step 4 algorithm).
// Never writes to the database.
//
// Step 56 — the actual matching/query algorithm moved to
// customer-search-query.ts's queryCustomers() (zero behavior change,
// same body) so /api/search/customers/route.ts can call it too without
// going through requireSession()'s redirect()-on-failure, which only
// behaves correctly inside a Server Component/Action render — not a
// Route Handler. This Server Action is kept, unchanged in its own
// behavior, for any caller that still wants the Action-invocation form;
// the client search UI (use-customer-search.ts) no longer calls it
// directly — see that file's own comment for why.
import { requireSession } from "@/lib/auth";
import { queryCustomers, type CustomerSearchResult } from "@/lib/customer-search-query";

export type { CustomerSearchResult };

export async function searchCustomers(rawQuery: string): Promise<CustomerSearchResult[]> {
  await requireSession();
  return queryCustomers(rawQuery);
}
