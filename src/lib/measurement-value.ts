// Shared decimal-value contract for measurement fields. Measurement AND
// MeasurementSnapshot both store the same 10 fields as Decimal(6,2), with
// the identical constraint: up to 4 integer digits, up to 2 decimal
// places, never negative. Extracted in Step 14 (order form / snapshot
// validation) from measurement-actions.ts's original Step 5 regex so the
// two validation paths can never quietly drift apart — both import this
// single copy rather than keeping their own.
import { z } from "zod";

export const DECIMAL_REGEX = /^\d{1,4}(\.\d{1,2})?$/;

export function decimalField(label: string) {
  return z
    .string()
    .trim()
    .regex(DECIMAL_REGEX, `${label} must be a valid non-negative number (e.g. 44 or 44.5)`)
    .optional();
}

// The 10 decimal fields shared by Measurement and MeasurementSnapshot, in
// the same order measurement-fields.ts and measurement-actions.ts use.
export const measurementValueSchema = z.object({
  length: decimalField("Length"),
  shoulder: decimalField("Shoulder"),
  sleeve: decimalField("Sleeve"),
  neck: decimalField("Neck"),
  chest: decimalField("Chest"),
  waist: decimalField("Waist"),
  hem: decimalField("Hem / Ghera"),
  shalwarLength: decimalField("Shalwar Length"),
  pancha: decimalField("Pancha"),
  shalwarGheraReady: decimalField("Shalwar Ghera Ready"),
  // "" = not specified (stored as null), never treated as a number.
  shalwarPocket: z.enum(["", "yes", "no"]),
});

export type MeasurementValueInput = z.infer<typeof measurementValueSchema>;

// Phase 6 (offline-first) — moved here (unchanged) from measurement-
// actions.ts, which can no longer export it directly: a "use server"
// file's exports must all be async Server Actions, and the new offline
// sync module (measurement-sync.ts) needs this exact schema too. This is
// a relocation, not a behavior change — measurement-actions.ts now
// imports it from here instead of defining its own copy.
export const measurementInputSchema = measurementValueSchema.extend({
  note: z.string().trim().max(1000, "Note is too long").optional(),
});

/** "" / "yes" / "no" -> null / true / false, same mapping measurement-actions.ts uses. */
export function shalwarPocketToBoolean(value: "" | "yes" | "no"): boolean | null {
  return value === "yes" ? true : value === "no" ? false : null;
}

/** Builds the plain data object (nulls for unset fields) for a Measurement or MeasurementSnapshot create/update. */
export function toMeasurementValueData(data: MeasurementValueInput) {
  return {
    length: data.length ?? null,
    shoulder: data.shoulder ?? null,
    sleeve: data.sleeve ?? null,
    neck: data.neck ?? null,
    chest: data.chest ?? null,
    waist: data.waist ?? null,
    hem: data.hem ?? null,
    shalwarLength: data.shalwarLength ?? null,
    pancha: data.pancha ?? null,
    shalwarGheraReady: data.shalwarGheraReady ?? null,
    shalwarPocket: shalwarPocketToBoolean(data.shalwarPocket),
  };
}
