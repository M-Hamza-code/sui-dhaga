// "Is this garment actually ordered" — a position's/garment's STRUCTURE
// (which OrderItem rows exist, which garment each one is, its quantity,
// its position number) is never decided by this file and never will be —
// that stays a plain admin-driven, structural fact exactly as it already
// was (order-actions.ts/order-build.ts/order-form.tsx's quantity fields).
// This file answers a narrower, purely DISPLAY/BILLING question for an
// already-fixed position: does it actually have real measurement data,
// so a garment whose tab was merely opened (defaulting its quantity to
// 1) without ever being filled in doesn't get charged or shown as
// ordered on the Receipt/Payment breakdown/Work Order.
//
// Kameez/Shalwar is priced by Suit Type, never by measurements (see
// computeKameezTotal's own comment) — so "ordered" for Kameez/Shalwar is
// Suit Type selected OR at least one measurement entered, composed by
// each caller (Suit Type lives in a different place depending on
// caller — Order.suitType/OrderItem.suitType server-side,
// state.suitType/item.style.suitType client-side — so this file only
// ever answers the measurement half; callers OR it with their own
// suitType check).
//
// Two mirrored halves, same reasoning as every other client/server
// boundary pair in this project (e.g. coat-garment-selection.ts): the
// server-side functions read an already-saved MeasurementSnapshot row
// (or null), where "empty" is `null`/`undefined`; the client-side
// functions read the order form's own live MeasurementBlockValues/
// CoatMeasurementBlockValues (plain Record<string, string>), where
// "empty" is `""`. Same field-key lists both sides, imported from the
// single existing source of truth for each (measurement-fields.ts,
// coat-measurement-fields.ts) — never duplicated here.

import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { COAT_FIELDS, WAISTCOAT_FIELDS } from "@/lib/coat-measurement-fields";

const KAMEEZ_SHALWAR_MEASUREMENT_KEYS: readonly string[] = [
  ...KAMEEZ_FIELDS.map((f) => f.key),
  ...SHALWAR_DECIMAL_FIELDS.map((f) => f.key),
  SHALWAR_POCKET_FIELD.key,
];
const PRINCE_COAT_MEASUREMENT_KEYS: readonly string[] = COAT_FIELDS.map((f) => f.key);
const WAISTCOAT_MEASUREMENT_KEYS: readonly string[] = WAISTCOAT_FIELDS.map((f) => f.key);

// ── Server-side: reads an already-saved MeasurementSnapshot row. ──────
function hasAnySavedValue(snapshot: Record<string, unknown> | null | undefined, keys: readonly string[]): boolean {
  if (!snapshot) return false;
  return keys.some((key) => snapshot[key] != null);
}
export function hasKameezMeasurementData(snapshot: Record<string, unknown> | null | undefined): boolean {
  return hasAnySavedValue(snapshot, KAMEEZ_SHALWAR_MEASUREMENT_KEYS);
}
export function hasPrinceCoatMeasurementData(snapshot: Record<string, unknown> | null | undefined): boolean {
  return hasAnySavedValue(snapshot, PRINCE_COAT_MEASUREMENT_KEYS);
}
export function hasWaistcoatMeasurementData(snapshot: Record<string, unknown> | null | undefined): boolean {
  return hasAnySavedValue(snapshot, WAISTCOAT_MEASUREMENT_KEYS);
}

// ── Client-side mirror: reads the order form's own live field values. ──
function hasAnyEnteredValue(values: Record<string, string>, keys: readonly string[]): boolean {
  return keys.some((key) => values[key] !== undefined && values[key] !== "");
}
export function hasKameezMeasurementDataClient(values: Record<string, string>): boolean {
  return hasAnyEnteredValue(values, KAMEEZ_SHALWAR_MEASUREMENT_KEYS);
}
export function hasPrinceCoatMeasurementDataClient(values: Record<string, string>): boolean {
  return hasAnyEnteredValue(values, PRINCE_COAT_MEASUREMENT_KEYS);
}
export function hasWaistcoatMeasurementDataClient(values: Record<string, string>): boolean {
  return hasAnyEnteredValue(values, WAISTCOAT_MEASUREMENT_KEYS);
}
