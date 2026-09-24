// Single source of truth for the Order form's fixed-choice fields — used
// by both order-form.tsx (style tiles) and the order detail/list views
// (human-readable labels), so the two can never drift out of sync.
//
// Labels and row order match sui-dhaga-design-brief.md §6b's style-block
// table verbatim (Step 14) — these are Roman-transliterated trade terms
// with no natural English equivalent, not a translation of the enum name.
//
// Step 57 — each option now also carries `imageSrc`, pointing at the
// shop's real design photos (copied as-is into public/design-images/,
// see that folder's own note). Mapped here, in the one place options are
// already defined, rather than a second parallel lookup table — the
// value/label/image for a given choice can never drift apart. Pocket and
// Patti/Placket aren't Prisma enums (see prisma/schema.prisma's own
// comment) — their options come from the DesignOption table at request
// time, keyed by a stable `code` (e.g. "POCKET_A"); DESIGN_OPTION_IMAGES
// below maps that same code to its image for those two categories.

import type { SuitType, CollarType, BainType, CuffType, GheraType } from "@prisma/client";

/** Every design photo lives at this fixed path, filename unchanged from the original (including spaces) — see public/design-images/. */
function designImage(filename: string): string {
  return `/design-images/${encodeURIComponent(filename)}`;
}

export const SUIT_TYPE_OPTIONS: { value: SuitType; label: string; imageSrc: string }[] = [
  { value: "SIMPLE", label: "Sada", imageSrc: designImage("Sada.jpeg") },
  { value: "DOUBLE_STITCH", label: "Double Silai", imageSrc: designImage("Double Silai.jpeg") },
  { value: "GARAM_SILAI", label: "Gum Silai", imageSrc: designImage("Gum Silai.jpeg") },
  { value: "DESIGNING", label: "Designing", imageSrc: designImage("Designing.jpeg") },
  { value: "BARABAR_SILAI", label: "Barabar Silai", imageSrc: designImage("Barabar Silai.jpeg") },
];

export const COLLAR_TYPE_OPTIONS: { value: CollarType; label: string; imageSrc: string }[] = [
  { value: "POINT", label: "Seedhi Nok", imageSrc: designImage("Seedhi Nok.jpeg") },
  { value: "FRENCH", label: "French", imageSrc: designImage("French.jpeg") },
  { value: "TIE", label: "Tie", imageSrc: designImage("Tie.jpeg") },
];

export const BAIN_TYPE_OPTIONS: { value: BainType; label: string; imageSrc: string }[] = [
  { value: "FULL_BAIN", label: "Full", imageSrc: designImage("Full.jpeg") },
  { value: "HALF_GOL_BAIN", label: "Half Gol", imageSrc: designImage("Half Gol.jpeg") },
  { value: "CUT_BAIN", label: "Cut", imageSrc: designImage("Cut Bain.jpeg") },
];

export const CUFF_TYPE_OPTIONS: { value: CuffType; label: string; imageSrc: string }[] = [
  { value: "NOK_DAR", label: "Nok Daar", imageSrc: designImage("Nok Daar.jpeg") },
  { value: "GOL", label: "Gol", imageSrc: designImage("Gol.jpeg") },
  { value: "CUT", label: "Cut", imageSrc: designImage("Cut.jpeg") },
  { value: "FOLD", label: "Fold", imageSrc: designImage("Fold.jpeg") },
];

export const GHERA_TYPE_OPTIONS: { value: GheraType; label: string; imageSrc: string }[] = [
  { value: "SEEDHA", label: "Seedha", imageSrc: designImage("Seedha Ghera.jpeg") },
  { value: "GOL", label: "Gol", imageSrc: designImage("Gol Ghera.jpeg") },
];

/**
 * Pocket (5 options) and Patti Style (3 options) are DesignOption rows,
 * not enums — their value/label come from the database, but the image is
 * a static, code-keyed lookup here, same as every other category. Codes
 * match prisma/seed.ts exactly; see that file's own comment.
 */
export const DESIGN_OPTION_IMAGES: Record<string, string> = {
  POCKET_A: designImage("Pocket A.jpeg"),
  POCKET_B: designImage("Pocket B.jpeg"),
  POCKET_C: designImage("Pocket C.jpeg"),
  POCKET_D: designImage("Pocket D.jpeg"),
  POCKET_E: designImage("Side Pocket.jpeg"),
  PATTI_A: designImage("Chorous Patti.jpeg"),
  PATTI_B: designImage("Nok Daar Patti.jpeg"),
  PATTI_C: designImage("Fold Patti.jpeg"),
};

function toLabelMap<T extends string>(options: { value: T; label: string }[]): Record<T, string> {
  return Object.fromEntries(options.map((o) => [o.value, o.label])) as Record<T, string>;
}

export const SUIT_TYPE_LABELS = toLabelMap(SUIT_TYPE_OPTIONS);
export const COLLAR_TYPE_LABELS = toLabelMap(COLLAR_TYPE_OPTIONS);
export const BAIN_TYPE_LABELS = toLabelMap(BAIN_TYPE_OPTIONS);
export const CUFF_TYPE_LABELS = toLabelMap(CUFF_TYPE_OPTIONS);
export const GHERA_TYPE_LABELS = toLabelMap(GHERA_TYPE_OPTIONS);

// Step 58 — same idea as toLabelMap above, but for the design photo
// instead of the display label. Lets the Print Work Order page (which
// only has the enum value, not the {value,label,imageSrc} option object)
// look up a suit's selected image by value, from the same single source
// of truth every option array already exports.
function toImageMap<T extends string>(options: { value: T; imageSrc: string }[]): Record<T, string> {
  return Object.fromEntries(options.map((o) => [o.value, o.imageSrc])) as Record<T, string>;
}

export const SUIT_TYPE_IMAGES = toImageMap(SUIT_TYPE_OPTIONS);
export const COLLAR_TYPE_IMAGES = toImageMap(COLLAR_TYPE_OPTIONS);
export const BAIN_TYPE_IMAGES = toImageMap(BAIN_TYPE_OPTIONS);
export const CUFF_TYPE_IMAGES = toImageMap(CUFF_TYPE_OPTIONS);
export const GHERA_TYPE_IMAGES = toImageMap(GHERA_TYPE_OPTIONS);
