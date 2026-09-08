// Single source of truth for the Order form's fixed-choice fields — used
// by both order-form.tsx (style tiles) and the order detail/list views
// (human-readable labels), so the two can never drift out of sync.
//
// Labels and row order match sui-dhaga-design-brief.md §6b's style-block
// table verbatim (Step 14) — these are Roman-transliterated trade terms
// with no natural English equivalent, not a translation of the enum name.

import type { SuitType, CollarType, BainType, CuffType, GheraType } from "@prisma/client";

export const SUIT_TYPE_OPTIONS: { value: SuitType; label: string }[] = [
  { value: "SIMPLE", label: "Sada" },
  { value: "DOUBLE_STITCH", label: "Double Silai" },
  { value: "GARAM_SILAI", label: "Gum Silai" },
  { value: "DESIGNING", label: "Designing" },
  { value: "BARABAR_SILAI", label: "Barabar Silai" },
];

export const COLLAR_TYPE_OPTIONS: { value: CollarType; label: string }[] = [
  { value: "POINT", label: "Seedhi Nok" },
  { value: "FRENCH", label: "French" },
  { value: "TIE", label: "Tie" },
];

export const BAIN_TYPE_OPTIONS: { value: BainType; label: string }[] = [
  { value: "FULL_BAIN", label: "Full" },
  { value: "HALF_GOL_BAIN", label: "Half Gol" },
  { value: "CUT_BAIN", label: "Cut" },
];

export const CUFF_TYPE_OPTIONS: { value: CuffType; label: string }[] = [
  { value: "NOK_DAR", label: "Nok Daar" },
  { value: "GOL", label: "Gol" },
  { value: "CUT", label: "Cut" },
  { value: "FOLD", label: "Fold" },
];

export const GHERA_TYPE_OPTIONS: { value: GheraType; label: string }[] = [
  { value: "SEEDHA", label: "Seedha" },
  { value: "GOL", label: "Gol" },
];

function toLabelMap<T extends string>(options: { value: T; label: string }[]): Record<T, string> {
  return Object.fromEntries(options.map((o) => [o.value, o.label])) as Record<T, string>;
}

export const SUIT_TYPE_LABELS = toLabelMap(SUIT_TYPE_OPTIONS);
export const COLLAR_TYPE_LABELS = toLabelMap(COLLAR_TYPE_OPTIONS);
export const BAIN_TYPE_LABELS = toLabelMap(BAIN_TYPE_OPTIONS);
export const CUFF_TYPE_LABELS = toLabelMap(CUFF_TYPE_OPTIONS);
export const GHERA_TYPE_LABELS = toLabelMap(GHERA_TYPE_OPTIONS);
