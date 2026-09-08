// Phase 11 (§1) — the pure matching rules customer-search.ts (Step 11,
// "use server") has always used, extracted so the new offline local
// search (src/lib/offline/customer-search-local.ts) can reuse the
// EXACT SAME rules instead of a second, drifting copy. A "use server"
// file's exports must all be async Server Actions (the established
// rule since Step 25's customer-validation.ts/order-build.ts
// extractions) — these are plain, synchronous, pure functions, so they
// couldn't stay there once a second (client-side) caller needed them.
//
// Nothing here changed behaviorally from what customer-search.ts
// already had — this is a relocation, not a rewrite. customer-search.ts
// now imports these instead of defining its own copy; its own
// behavior/output is completely unchanged.
export const RESULT_LIMIT = 8;
export const SIMILARITY_THRESHOLD = 0.5;

export function isPhoneQuery(query: string): boolean {
  return /^[0-9+]/.test(query);
}

/**
 * Roman-spelling-tolerant name key: lowercase, strip non-letters, collapse
 * doubled letters, drop non-word-initial vowels. E.g. "Hammad"/"Hamad"/
 * "Hammed" -> "hmd"; "Muhammad"/"Mohammed" -> "mhmd". Matches the
 * authoritative mockup's nameKey() exactly.
 */
export function nameKey(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z ]/g, "");
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const collapsed = word.replace(/(.)\1+/g, "$1");
      return collapsed.charAt(0) + collapsed.slice(1).replace(/[aeiouy]/g, "");
    })
    .join(" ");
}

function trigrams(value: string): string[] {
  const padded = ` ${value.replace(/ /g, "")} `;
  const grams: string[] = [];
  for (let i = 0; i < padded.length - 2; i++) {
    grams.push(padded.slice(i, i + 3));
  }
  return grams;
}

/** Trigram similarity in [0, 1]. 1 if `b` literally contains `a`. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (b.includes(a)) return 1;
  const gramsA = trigrams(a);
  const gramsB = new Set(trigrams(b));
  let hits = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) hits++;
  }
  return hits / Math.max(1, gramsA.length);
}

/**
 * Exact Customer Code matching (Phase 11 §1) — a capability the online
 * searchCustomers() has never had at all ("customerCode is deliberately
 * NOT part of this algorithm" — its own file header) and still doesn't;
 * this is added ONLY for the new offline local search, which this phase
 * explicitly asks to support "search by Customer Code" — a deliberate,
 * additive difference from the online path, not an oversight. Matches
 * the full code case-insensitively ("SD-000123"), or just its numeric
 * part with or without leading zeros ("123", "000123").
 */
export function matchesCustomerCode(customerCode: string | null, query: string): boolean {
  if (!customerCode) return false;
  const normalizedQuery = query.trim().toUpperCase();
  if (!normalizedQuery) return false;
  if (customerCode.toUpperCase() === normalizedQuery) return true;
  const codeDigits = customerCode.replace(/\D/g, "").replace(/^0+/, "");
  const queryDigits = normalizedQuery.replace(/\D/g, "").replace(/^0+/, "");
  return queryDigits.length > 0 && codeDigits === queryDigits;
}
