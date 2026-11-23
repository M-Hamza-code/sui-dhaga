// Explicit garment selection upgrade — one tiny, framework-agnostic
// source of truth for "what does PRINCE_COAT/WAISTCOAT/BOTH actually
// mean," reused by both the client Order Form (pricing AND measurement
// visibility) and server-rendered pages (Order Detail, Work Order). Pure
// data logic — no Prisma, no DOM — so it's safe to import from a "use
// client" component and a React Server Component alike, same reasoning
// coat-measurement-value.ts's own cross-boundary comment already gives.
export type CoatGarmentSelectionLike = "PRINCE_COAT" | "WAISTCOAT" | "BOTH";

export function includesPrinceCoat(selection: CoatGarmentSelectionLike): boolean {
  return selection === "PRINCE_COAT" || selection === "BOTH";
}

export function includesWaistcoat(selection: CoatGarmentSelectionLike): boolean {
  return selection === "WAISTCOAT" || selection === "BOTH";
}

/**
 * Shared/default measurement visibility — "show the union of the garment
 * groups selected across all [relevant] Coat entries": PRINCE_COAT-only
 * if every given selection is PRINCE_COAT, WAISTCOAT-only if every one is
 * WAISTCOAT, BOTH the moment they disagree or any one of them is
 * genuinely BOTH. Returns null for an empty list — "no entries are
 * actually relevant to this shared block right now" — so callers can
 * apply their own fallback (every current caller falls back to "BOTH",
 * matching this project's own "show everything when nothing constrains
 * it" convention elsewhere).
 */
export function unionCoatGarmentSelection(selections: CoatGarmentSelectionLike[]): CoatGarmentSelectionLike | null {
  if (selections.length === 0) return null;
  const hasPrinceCoat = selections.some(includesPrinceCoat);
  const hasWaistcoat = selections.some(includesWaistcoat);
  if (hasPrinceCoat && hasWaistcoat) return "BOTH";
  if (hasPrinceCoat) return "PRINCE_COAT";
  return "WAISTCOAT";
}
