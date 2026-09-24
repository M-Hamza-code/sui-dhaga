// Step 56 — the actual customer-search algorithm, extracted out of
// customer-search.ts (Step 11) so it can be called from BOTH that file's
// existing "use server" Action (unchanged export, unchanged behavior —
// still requireSession() then this) AND the new /api/search/customers
// Route Handler (search-focus-loss fix — see that route's own comment
// for why a plain fetch() replaced calling the Server Action directly
// from client code). Zero behavior change: this is the exact same body
// searchCustomers already had, just given its own auth-free home so two
// different auth-check styles (requireSession()'s redirect() vs a Route
// Handler's own 401 JSON response) can each wrap it without duplicating
// the actual matching/query logic.
import { prisma } from "@/lib/prisma";
import { normalizePhoneDigits as normalizePhone } from "@/lib/phone";
import { nameKey, similarity, isPhoneQuery, RESULT_LIMIT, SIMILARITY_THRESHOLD } from "@/lib/customer-search-matching";

export interface CustomerSearchResult {
  id: string;
  name: string;
  phonePrimary: string;
  orderCount: number;
  lastOrderAt: Date | null;
  measurementUpdatedAt: Date | null;
}

/**
 * Never filters on order count — a customer with zero orders (a brand
 * new customer, or one whose only order was just deleted — Step 55) is
 * just as searchable as any other non-deleted customer; orderCount/
 * lastOrderAt below are display metadata only, never part of the match
 * itself. See customer-search.ts's own header for the full algorithm
 * description (phone vs fuzzy-name matching, always requires an active
 * session).
 */
export async function queryCustomers(rawQuery: string): Promise<CustomerSearchResult[]> {
  const query = rawQuery.trim();
  if (!query) {
    return [];
  }

  let matchedIds: string[];

  if (isPhoneQuery(query)) {
    const digits = normalizePhone(query);
    if (!digits) return [];

    const candidates = await prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, phonePrimary: true, phoneSecondary: true },
    });
    matchedIds = candidates
      .filter(
        (c) =>
          normalizePhone(c.phonePrimary).includes(digits) ||
          (c.phoneSecondary ? normalizePhone(c.phoneSecondary).includes(digits) : false)
      )
      .map((c) => c.id);
  } else {
    const key = nameKey(query);
    if (!key) return [];

    const candidates = await prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    matchedIds = candidates
      .map((c) => ({ id: c.id, score: similarity(key, nameKey(c.name)) }))
      .filter((c) => c.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .map((c) => c.id);
  }

  if (matchedIds.length === 0) {
    return [];
  }

  // Fetch display data + aggregates only for the matched customers.
  const customers = await prisma.customer.findMany({
    where: { id: { in: matchedIds } },
    select: {
      id: true,
      name: true,
      phonePrimary: true,
      orders: { select: { orderDate: true }, orderBy: { orderDate: "desc" }, take: 1 },
      _count: { select: { orders: true } },
      measurement: { select: { updatedAt: true } },
    },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));

  return matchedIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => ({
      id: c.id,
      name: c.name,
      phonePrimary: c.phonePrimary,
      orderCount: c._count.orders,
      lastOrderAt: c.orders[0]?.orderDate ?? null,
      measurementUpdatedAt: c.measurement?.updatedAt ?? null,
    }))
    .sort((a, b) => {
      // Most-recent-order-date first, always — never primarily by match
      // score. Customers with no order sort last. Array.sort is stable,
      // so ties (both no-order, or the rare identical timestamp) keep
      // their prior relative order — which for name search is still the
      // match-quality order established above, now just a tiebreaker.
      if (a.lastOrderAt && b.lastOrderAt) return b.lastOrderAt.getTime() - a.lastOrderAt.getTime();
      if (a.lastOrderAt) return -1;
      if (b.lastOrderAt) return 1;
      return 0;
    })
    .slice(0, RESULT_LIMIT);
}
