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

// Upgrade — independent Coat/Waistcoat ordering. Two more fixed keys in
// the SAME schemaless defaultPrices JSON (never a separate column —
// this bag was already designed to hold "garment -> default price," and
// Prince Coat/Waistcoat are just two more garments, not SuitType values).
// Kept as its own small map/function rather than folded into
// DefaultPricesMap/parseDefaultPrices above: those are keyed strictly by
// the SuitType enum (used for per-suit-type pricing), where these two are
// a different, fixed pair — mixing the two key spaces into one type would
// make "is this key a SuitType or a garment" ambiguous everywhere it's read.
export type DefaultGarmentPricesMap = { PRINCE_COAT: string; WAISTCOAT: string };

/** "Must initially be Rs. 5,000 / 3,000" — the fallback used whenever Settings has never been saved with these keys yet. No data migration needed: the first real Settings save persists a real value from here. */
export const DEFAULT_GARMENT_PRICE_FALLBACK: DefaultGarmentPricesMap = {
  PRINCE_COAT: "5000.00",
  WAISTCOAT: "3000.00",
};

/** Same "only a MONEY_REGEX-valid string survives, anything else is dropped" rule as parseDefaultPrices, falling back to DEFAULT_GARMENT_PRICE_FALLBACK per-key when the stored JSON doesn't have it (or was never saved at all). */
export function parseDefaultGarmentPrices(value: unknown): DefaultGarmentPricesMap {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const result = { ...DEFAULT_GARMENT_PRICE_FALLBACK };
  for (const key of Object.keys(DEFAULT_GARMENT_PRICE_FALLBACK) as (keyof DefaultGarmentPricesMap)[]) {
    const raw = source[key];
    if (typeof raw === "string" && MONEY_REGEX.test(raw)) {
      result[key] = raw;
    }
  }
  return result;
}
