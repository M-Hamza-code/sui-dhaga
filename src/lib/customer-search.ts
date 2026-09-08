"use server";

// Global customer search (Step 11 — replaces the Step 4 algorithm). Never
// writes to the database.
//
// Per the design brief (§5) and the authoritative mockup's own reference
// implementation:
//   - Digit-first input -> phone search, matched against a normalized
//     (country-code/trunk-zero stripped) digit string.
//   - Letter-first input -> fuzzy Roman-name search: a normalized "name
//     key" (non-initial vowels stripped, doubled letters collapsed) is
//     compared by trigram similarity, threshold >= 0.5. This is what
//     makes "hamad" find "Hammad Rasheed".
//   - customerCode (SD-######) is deliberately NOT part of this
//     algorithm at all — the brief's search is phone/name only.
//   - Final result order is always most-recent-order-date first,
//     regardless of match method — never primarily by fuzzy score.
//
// No pg_trgm / schema changes: this shop is single-tenant at a scale
// (tens to low hundreds of customers) where scoring the whole active
// customer set in memory is simple, fast, and — critically — able to
// find the true best matches without a database-side LIMIT silently
// excluding a candidate before it's ever scored.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { normalizePhoneDigits as normalizePhone } from "@/lib/phone";
// Phase 11 (§1) — nameKey/similarity/isPhoneQuery/RESULT_LIMIT/
// SIMILARITY_THRESHOLD were extracted into their own plain module so
// the new offline local search (customer-search-local.ts) could reuse
// the EXACT SAME matching rules rather than a second, drifting copy —
// see that module's own header. Nothing about their behavior changed;
// this file's own output is identical to before.
import { nameKey, similarity, isPhoneQuery, RESULT_LIMIT, SIMILARITY_THRESHOLD } from "@/lib/customer-search-matching";

export interface CustomerSearchResult {
  id: string;
  name: string;
  phonePrimary: string;
  orderCount: number;
  lastOrderAt: Date | null;
  measurementUpdatedAt: Date | null;
}

// Phone digit-normalization itself now lives in phone.ts (Step 17 pulled
// it out so the WhatsApp deep-link builder could reuse it too) — imported
// above under its original local name so nothing below this line changed.

export async function searchCustomers(rawQuery: string): Promise<CustomerSearchResult[]> {
  await requireSession();

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
