// Single source of truth for the 21 Prince Coat + Waistcoat measurement
// fields' on-screen Urdu + English labels — mirrors measurement-fields.ts's
// own KAMEEZ_FIELDS/SHALWAR_DECIMAL_FIELDS pattern exactly, for the
// separate Coat garment family (see prisma/schema.prisma's CoatMeasurement
// model comment). Field keys match CoatMeasurement/MeasurementSnapshot's
// own column names one-to-one.
//
// Urdu glyphs are a best-effort tailoring-terminology transliteration,
// reviewed and approved by the shop owner on 2026-11-20 (see the
// conversation this was built in) — same "confirm/correct with the shop
// owner" honesty convention measurement-fields.ts already carries for Arm
// Hole/Kohni. Several fields reuse the same Urdu word across both groups
// (Shoulder, Chest, Waist, Hip/Seat, Arm Hole, Neck, Back Width, Front
// Length) since it's the same body measurement in both garments — the
// section heading ("Prince Coat" vs "Waistcoat") disambiguates which.

import type { CoatMeasurement } from "@prisma/client";

type CoatFieldKey =
  | "coatLength"
  | "coatShoulder"
  | "coatChest"
  | "coatWaist"
  | "coatHipSeat"
  | "coatSleeve"
  | "coatArmHole"
  | "coatBicep"
  | "coatCuff"
  | "coatNeck"
  | "coatBackWidth"
  | "coatFrontLength";

type WaistcoatFieldKey =
  | "waistcoatLength"
  | "waistcoatShoulder"
  | "waistcoatChest"
  | "waistcoatWaist"
  | "waistcoatHipSeat"
  | "waistcoatArmHole"
  | "waistcoatNeck"
  | "waistcoatBackWidth"
  | "waistcoatFrontLength";

interface CoatMeasurementFieldDef<K extends keyof CoatMeasurement> {
  key: K;
  ur: string;
  label: string;
}

export const COAT_FIELDS: readonly CoatMeasurementFieldDef<CoatFieldKey>[] = [
  { key: "coatLength", ur: "کوٹ کی لمبائی", label: "Coat Length" },
  { key: "coatShoulder", ur: "تیرا", label: "Shoulder" },
  { key: "coatChest", ur: "چھاتی", label: "Chest" },
  { key: "coatWaist", ur: "کمر", label: "Waist" },
  { key: "coatHipSeat", ur: "کولہا", label: "Hip / Seat" },
  { key: "coatSleeve", ur: "آستین کی لمبائی", label: "Sleeve Length" },
  { key: "coatArmHole", ur: "بازو کا گھیرا", label: "Arm Hole" },
  { key: "coatBicep", ur: "بازو کی موٹائی", label: "Bicep" },
  { key: "coatCuff", ur: "کف", label: "Cuff" },
  { key: "coatNeck", ur: "گلا", label: "Neck" },
  { key: "coatBackWidth", ur: "پیٹھ کی چوڑائی", label: "Back Width" },
  { key: "coatFrontLength", ur: "سامنے کی لمبائی", label: "Front Length" },
];

export const WAISTCOAT_FIELDS: readonly CoatMeasurementFieldDef<WaistcoatFieldKey>[] = [
  { key: "waistcoatLength", ur: "ویسٹ کوٹ کی لمبائی", label: "Waistcoat Length" },
  { key: "waistcoatShoulder", ur: "تیرا", label: "Shoulder" },
  { key: "waistcoatChest", ur: "چھاتی", label: "Chest" },
  { key: "waistcoatWaist", ur: "کمر", label: "Waist" },
  { key: "waistcoatHipSeat", ur: "کولہا", label: "Hip / Seat" },
  { key: "waistcoatArmHole", ur: "بازو کا گھیرا", label: "Arm Hole" },
  { key: "waistcoatNeck", ur: "گلا", label: "Neck" },
  { key: "waistcoatBackWidth", ur: "پیٹھ کی چوڑائی", label: "Back Width" },
  { key: "waistcoatFrontLength", ur: "سامنے کی لمبائی", label: "Front Length" },
];

export const ALL_COAT_FIELD_KEYS: readonly string[] = [...COAT_FIELDS.map((f) => f.key), ...WAISTCOAT_FIELDS.map((f) => f.key)];
