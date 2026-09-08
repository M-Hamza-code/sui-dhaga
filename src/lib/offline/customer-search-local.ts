// Phase 11 (§1 Customer Search) — offline-capable customer search over
// the EXISTING local `customers`/`orders`/`measurements` Dexie tables
// (Phase 2/3), reusing the EXACT SAME matching rules
// customer-search.ts's searchCustomers() Server Action uses (via the
// shared customer-search-matching.ts module extracted for this) —
// not a second, drifting search algorithm.
//
// Deliberately mirrors searchCustomers()'s own shape/ranking as closely
// as possible: same CustomerSearchResult return type, same
// phone-first-if-digits / else-fuzzy-name branching, same final
// most-recent-order-date-first sort, same RESULT_LIMIT. The one
// intentional addition — exact Customer Code matching — is explained
// in customer-search-matching.ts's own comment (Phase 11 explicitly
// asks for it; the online path has never supported it).
//
// Scans the full local `customers` table (tens to low hundreds of rows
// per this app's own existing scale assumption — customer-search.ts's
// own file header) rather than a Dexie range query, exactly mirroring
// the SAME "score the whole active set in memory" approach the online
// implementation already uses — not a regression, the same established
// design applied locally.
import { getOfflineDb, isOfflineDbAvailable } from "./db";
import { normalizePhoneDigits } from "@/lib/phone";
import { nameKey, similarity, isPhoneQuery, matchesCustomerCode, RESULT_LIMIT, SIMILARITY_THRESHOLD } from "@/lib/customer-search-matching";
import type { CustomerSearchResult } from "@/lib/customer-search";

export async function searchCustomersLocally(rawQuery: string): Promise<CustomerSearchResult[]> {
  if (!isOfflineDbAvailable()) return [];

  const query = rawQuery.trim();
  if (!query) return [];

  const db = getOfflineDb();
  await db.open();

  // Includes locally-created, not-yet-synced customers (Phase 5) —
  // they're ordinary rows in this same table, no separate handling
  // needed. Soft-deleted customers are excluded, same as the online
  // path's own `where: { deletedAt: null }`.
  const allCustomers = await db.customers.toArray();
  const active = allCustomers.filter((c) => !c.deletedAt);

  // Exact Customer Code match — additive, see customer-search-matching.ts.
  const codeMatchIds = active.filter((c) => matchesCustomerCode(c.customerCode, query)).map((c) => c.id);

  let primaryMatchIds: string[];
  if (isPhoneQuery(query)) {
    const digits = normalizePhoneDigits(query);
    primaryMatchIds = digits
      ? active
          .filter(
            (c) =>
              normalizePhoneDigits(c.phonePrimary).includes(digits) ||
              (c.phoneSecondary ? normalizePhoneDigits(c.phoneSecondary).includes(digits) : false)
          )
          .map((c) => c.id)
      : [];
  } else {
    const key = nameKey(query);
    primaryMatchIds = key
      ? active
          .map((c) => ({ id: c.id, score: similarity(key, nameKey(c.name)) }))
          .filter((c) => c.score >= SIMILARITY_THRESHOLD)
          .sort((a, b) => b.score - a.score)
          .map((c) => c.id)
      : [];
  }

  // Union, code matches first (a direct code hit is the highest-
  // confidence signal) — deduplicated; the final sort below still
  // reorders everything by most-recent-order-date regardless, exactly
  // like the online path, so this union order only matters as a
  // tiebreaker.
  const matchedIds = Array.from(new Set([...codeMatchIds, ...primaryMatchIds]));
  if (matchedIds.length === 0) return [];

  const byId = new Map(active.map((c) => [c.id, c]));

  const [orders, measurements] = await Promise.all([
    db.orders.where("customerId").anyOf(matchedIds).toArray(),
    db.measurements.where("customerId").anyOf(matchedIds).toArray(),
  ]);

  const orderCountById = new Map<string, number>();
  const lastOrderAtById = new Map<string, string>();
  for (const order of orders) {
    orderCountById.set(order.customerId, (orderCountById.get(order.customerId) ?? 0) + 1);
    const prev = lastOrderAtById.get(order.customerId);
    if (!prev || order.orderDate > prev) {
      lastOrderAtById.set(order.customerId, order.orderDate);
    }
  }
  const measurementUpdatedAtById = new Map(measurements.map((m) => [m.customerId, m.updatedAt]));

  return matchedIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c): CustomerSearchResult => {
      const lastOrderAtIso = lastOrderAtById.get(c.id);
      const measurementUpdatedAtIso = measurementUpdatedAtById.get(c.id);
      return {
        id: c.id,
        name: c.name,
        phonePrimary: c.phonePrimary,
        orderCount: orderCountById.get(c.id) ?? 0,
        lastOrderAt: lastOrderAtIso ? new Date(lastOrderAtIso) : null,
        measurementUpdatedAt: measurementUpdatedAtIso ? new Date(measurementUpdatedAtIso) : null,
      };
    })
    .sort((a, b) => {
      // Same rule as searchCustomers()'s own final sort — most-recent-
      // order-date first, never primarily by match score/order.
      if (a.lastOrderAt && b.lastOrderAt) return b.lastOrderAt.getTime() - a.lastOrderAt.getTime();
      if (a.lastOrderAt) return -1;
      if (b.lastOrderAt) return 1;
      return 0;
    })
    .slice(0, RESULT_LIMIT);
}
