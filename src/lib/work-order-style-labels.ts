// Urdu print labels for the Karigar Work Order (Step 22) — sourced
// directly from the authoritative "Sui Dhaga v2.dc.html" mockup's own
// GROUPS table (its karigar work-order print section), joined here
// against order-options.ts's already-confirmed Roman labels rather than
// re-typed from scratch, so a mismatch between the two would show up as
// a missing map entry, not a silent wrong pairing:
//   SIMPLE="Sada"→سادہ سوٹ, DOUBLE_STITCH="Double Silai"→ڈبل سلائی سوٹ,
//   GARAM_SILAI="Gum Silai"→گم سلائی سوٹ, DESIGNING→ڈیزائننگ سوٹ,
//   BARABAR_SILAI→برابر سلائی, POINT="Seedhi Nok"→سیدھی نوک کالر,
//   FRENCH→فرنچ کالر, TIE→ٹائی کالر, FULL_BAIN="Full"→فل بین,
//   HALF_GOL_BAIN="Half Gol"→ہاف گول بین, CUT_BAIN="Cut"→کٹ بین,
//   NOK_DAR="Nok Daar"→نوک دار کف, GOL(cuff)="Gol"→گول کف, CUT→کٹ کف,
//   FOLD→فولڈ کف, SEEDHA="Seedha"→گھیرا سیدھا, GOL(ghera)="Gol"→گھیرا گول.
//
// These are ONLY for the karigar print output — the on-screen S3/S4
// English Roman labels in order-options.ts are untouched and unrelated,
// and nothing here changes what those enums mean or how they're stored.
//
// Pocket is deliberately NOT included here: its real design names are
// still unconfirmed placeholder data on DesignOption (see the Step 6/8
// audit — "Pocket Design A (PLACEHOLDER — confirm real name)"), and
// inventing Urdu names for them would be fabricating content, which the
// brief explicitly forbids. The Work Order page instead prints the
// DesignOption's existing label exactly as stored when a pocket is
// selected — an honest placeholder, not a translation.
import type { SuitType, CollarType, BainType, CuffType, GheraType } from "@prisma/client";

export const SUIT_TYPE_UR: Record<SuitType, string> = {
  SIMPLE: "سادہ سوٹ",
  DOUBLE_STITCH: "ڈبل سلائی سوٹ",
  GARAM_SILAI: "گم سلائی سوٹ",
  DESIGNING: "ڈیزائننگ سوٹ",
  BARABAR_SILAI: "برابر سلائی",
};

export const COLLAR_TYPE_UR: Record<CollarType, string> = {
  POINT: "سیدھی نوک کالر",
  FRENCH: "فرنچ کالر",
  TIE: "ٹائی کالر",
};

export const BAIN_TYPE_UR: Record<BainType, string> = {
  FULL_BAIN: "فل بین",
  HALF_GOL_BAIN: "ہاف گول بین",
  CUT_BAIN: "کٹ بین",
};

export const CUFF_TYPE_UR: Record<CuffType, string> = {
  NOK_DAR: "نوک دار کف",
  GOL: "گول کف",
  CUT: "کٹ کف",
  FOLD: "فولڈ کف",
};

export const GHERA_TYPE_UR: Record<GheraType, string> = {
  SEEDHA: "گھیرا سیدھا",
  GOL: "گھیرا گول",
};

// Fixed print-sheet copy — headings/labels the brief requires in Urdu
// that aren't tied to any enum. Kameez/Shalwar section titles use
// Nastaliq on the print sheet per both the brief (§2: "Print headings...
// Noto Nastaliq Urdu") and the mockup's own print template (its
// measurement-section titles and row labels are Nastaliq there, not the
// Naskh used for the same words on screen in S2/S3).
export const WORK_ORDER_UR = {
  kameezHeading: "قمیض",
  shalwarHeading: "شلوار",
  deliveryDateLabel: "تاریخ واپسی",
  yes: "ہاں",
  no: "نہیں",
  measurementsNotAvailable: "پیمائش دستیاب نہیں",
} as const;

/** "سوٹ 1 از 2" — "Suit 1 of 2". */
export function suitOfTotalUr(position: number, total: number): string {
  return `سوٹ ${position} از ${total}`;
}
