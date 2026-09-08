// Shared helpers for ShopSettings.defaultPrices (Step 9 model, Step 18
// gives it a real reader/writer). The schema comment describes the
// intended shape: "Suit-type -> default price, keyed by the existing
// SuitType enum values as strings". This module is the ONE place that
// shape is trusted from — both the Settings form (writing it) and the
// Order form (reading it as a default suggestion) go through
// parseDefaultPrices() rather than reading the raw JSON column directly,
// so a malformed/legacy value can never silently reach either as if it
// were valid data.
import type { SuitType } from "@prisma/client";
import { MONEY_REGEX } from "@/lib/money";
import { SUIT_TYPE_OPTIONS } from "@/lib/order-options";

export type DefaultPricesMap = Partial<Record<SuitType, string>>;

/**
 * Narrows an unknown JSON value (ShopSettings.defaultPrices, or anything
 * a client claims that shape is) into a validated {SuitType: "1200.00"}
 * map. Never trusts arbitrary JSON: only the 5 real SuitType keys are
 * looked at, and a value is kept only if it's a string matching
 * MONEY_REGEX — anything else for that key is silently dropped, not
 * defaulted to a placeholder.
 */
export function parseDefaultPrices(value: unknown): DefaultPricesMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: DefaultPricesMap = {};
  for (const option of SUIT_TYPE_OPTIONS) {
    const raw = source[option.value];
    if (typeof raw === "string" && MONEY_REGEX.test(raw)) {
      result[option.value] = raw;
    }
  }
  return result;
}
