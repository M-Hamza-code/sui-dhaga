// Single source of truth for the 11 measurement fields' on-screen Urdu
// labels — [DB field key, Urdu label, Roman/English gloss], matching the
// authoritative mockup's KAMEEZ/SHALWAR arrays exactly. Used by S2's
// read-only display now; the Step 13 measurement input rebuild (fraction
// buttons, keyboard sequence, body diagram) will reuse the same list
// rather than re-deriving its own.

import type { Measurement } from "@prisma/client";

type DecimalFieldKey = "length" | "shoulder" | "sleeve" | "neck" | "chest" | "waist" | "hem";
type ShalwarDecimalFieldKey = "shalwarLength" | "pancha" | "shalwarGheraReady";

interface MeasurementFieldDef<K extends keyof Measurement> {
  key: K;
  ur: string;
  label: string;
}

export const KAMEEZ_FIELDS: readonly MeasurementFieldDef<DecimalFieldKey>[] = [
  { key: "length", ur: "لمبائی", label: "Length" },
  { key: "shoulder", ur: "تیرا", label: "Shoulder" },
  { key: "sleeve", ur: "بازو", label: "Sleeve" },
  { key: "neck", ur: "گلا", label: "Neck" },
  { key: "chest", ur: "چھاتی", label: "Chest" },
  { key: "waist", ur: "کمر", label: "Waist" },
  { key: "hem", ur: "گھیرا", label: "Hem" },
];

export const SHALWAR_DECIMAL_FIELDS: readonly MeasurementFieldDef<ShalwarDecimalFieldKey>[] = [
  { key: "shalwarLength", ur: "لمبائی", label: "Length" },
  { key: "pancha", ur: "پانچہ", label: "Pancha" },
  { key: "shalwarGheraReady", ur: "گھیرا تیار", label: "Finished Hem" },
];

// shalwarPocket is Boolean?, not Decimal? — kept separate so the two
// decimal lists above stay uniformly typed for their display formatter.
export const SHALWAR_POCKET_FIELD = { key: "shalwarPocket", ur: "پاکٹ", label: "Pocket" } as const;
