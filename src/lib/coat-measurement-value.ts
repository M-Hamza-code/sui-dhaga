// Shared decimal-value contract for Prince Coat + Waistcoat measurement
// fields — the Coat-mode equivalent of measurement-value.ts, same
// structure, same reused `decimalField()` helper (so a Coat field can never
// enforce a different "what counts as a valid number" rule than a Kameez
// field does).
import { z } from "zod";
import { decimalField } from "@/lib/measurement-value";
import { COAT_FIELDS, WAISTCOAT_FIELDS } from "@/lib/coat-measurement-fields";

const coatShape = Object.fromEntries(COAT_FIELDS.map((f) => [f.key, decimalField(f.label)])) as Record<
  (typeof COAT_FIELDS)[number]["key"],
  ReturnType<typeof decimalField>
>;
const waistcoatShape = Object.fromEntries(WAISTCOAT_FIELDS.map((f) => [f.key, decimalField(`Waistcoat ${f.label}`)])) as Record<
  (typeof WAISTCOAT_FIELDS)[number]["key"],
  ReturnType<typeof decimalField>
>;

export const coatMeasurementValueSchema = z.object({ ...coatShape, ...waistcoatShape });

export type CoatMeasurementValueInput = z.infer<typeof coatMeasurementValueSchema>;

export const coatMeasurementInputSchema = coatMeasurementValueSchema.extend({
  note: z.string().trim().max(1000, "Note is too long").optional(),
});

/** Builds the plain data object (nulls for unset fields) for a CoatMeasurement or MeasurementSnapshot create/update — mirrors toMeasurementValueData() in measurement-value.ts. */
export function toCoatMeasurementValueData(data: CoatMeasurementValueInput) {
  const out: Record<string, string | null> = {};
  for (const key of [...COAT_FIELDS.map((f) => f.key), ...WAISTCOAT_FIELDS.map((f) => f.key)]) {
    out[key] = (data as Record<string, string | undefined>)[key] ?? null;
  }
  return out as { [K in keyof CoatMeasurementValueInput]: string | null };
}

// Independent Prince Coat/Waistcoat pricing fix — "charge only for the
// garment(s) actually included in an entry," determined by which field
// group actually has a value, never by an admin-facing flag or a schema
// column (deliberately zero schema change: MeasurementSnapshot already
// stores the two groups in fully disjoint columns, so "does this
// entry/snapshot include a Prince Coat" is already honestly answerable
// from data that already exists). One shape, reused from three different
// callers with three different field-value types (plain form strings in
// order-form.tsx, Zod-parsed strings in order-actions.ts, and Prisma
// Decimal|null on an already-saved MeasurementSnapshot in the order
// detail page) — hence the generic `Record<string, unknown>` input rather
// than CoatMeasurementValueInput specifically.
function isFieldPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true; // a non-null Decimal/number — a real measurement was recorded
}

/** True if ANY Prince Coat field (COAT_FIELDS) has a value — this entry/snapshot includes a Prince Coat. */
export function hasPrinceCoatContent(data: Record<string, unknown>): boolean {
  return COAT_FIELDS.some((f) => isFieldPresent(data[f.key]));
}

/** True if ANY Waistcoat field (WAISTCOAT_FIELDS) has a value — this entry/snapshot includes a Waistcoat. */
export function hasWaistcoatContent(data: Record<string, unknown>): boolean {
  return WAISTCOAT_FIELDS.some((f) => isFieldPresent(data[f.key]));
}
