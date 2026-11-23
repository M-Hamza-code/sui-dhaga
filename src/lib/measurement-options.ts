// Predefined-value SUGGESTIONS for measurement fields (shown via a
// <datalist>, not a <select> — see measurement-form.tsx/
// order-measurement-block.tsx's own comments on why a <select> was the
// wrong control: it can only ever hold one of its own listed values, so
// it can never accept a freely-typed custom number). These are
// suggestions only, never a restriction — any custom value, in or out of
// range, decimal or whole, is still accepted and saved exactly as typed.
//
// Fixed ranges (as specified), centralized here so they can be adjusted
// later by editing only this one table — no caller needs to change.
// Values are inches. "step: 1" fields intentionally have NO half-inch
// options (Chest/Hem/Waist/Finished Ghera); every other field steps by
// 0.5.
interface RangeSpec {
  start: number;
  end: number;
  step: number;
}

export const MEASUREMENT_RANGES: Record<string, RangeSpec> = {
  // Kameez
  length: { start: 36, end: 42, step: 0.5 },
  shoulder: { start: 14, end: 20, step: 0.5 },
  sleeve: { start: 22, end: 26, step: 0.5 },
  // Kohni has no range in the given spec — placeholder only, matching
  // Arm Hole's range as the closest anatomically-similar field. Flagged
  // for confirmation; not load-bearing (suggestions only).
  kohni: { start: 10, end: 14, step: 0.5 },
  armHole: { start: 10, end: 14, step: 0.5 },
  neck: { start: 14, end: 19, step: 0.5 },
  chest: { start: 22, end: 42, step: 1 },
  waist: { start: 22, end: 32, step: 1 },
  hem: { start: 22, end: 42, step: 1 },
  // Shalwar
  shalwarLength: { start: 37, end: 42, step: 0.5 },
  // NUMERIC shalwar-cuff-width measurement — distinct from the PANCHA
  // design/style option (Order.panchaOptionId). See schema.prisma's own
  // comment on this field for the full distinction.
  pancha: { start: 7, end: 12, step: 0.5 },
  // "Finished Ghera" in the given spec — this app's existing field name.
  shalwarGheraReady: { start: 20, end: 30, step: 1 },
};

/** "36.5" -> 3650 (hundredths) — no floating-point arithmetic on measurement values, same rule this app already applies to money. */
function toCents(n: number): number {
  return Math.round(n * 100);
}

/** The exact inverse of toCents — formats integer hundredths back to the shortest equivalent decimal string ("4200" -> "42", "3650" -> "36.5"). */
function fromCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  if (frac === 0) return String(whole);
  if (frac % 10 === 0) return `${whole}.${frac / 10}`;
  return `${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * This field's fixed list of predefined suggestions, both ends inclusive.
 * Returns an empty array for a field with no configured range (none
 * currently exist, but a future field added to measurement-fields.ts
 * without a matching entry here simply gets no suggestions — never a
 * crash). Independent of any currently saved value — Task 2 explicitly
 * replaced the old dynamic ("start from the current value") rule.
 */
export function measurementOptionsFor(fieldKey: string): string[] {
  const range = MEASUREMENT_RANGES[fieldKey];
  if (!range) return [];
  const startCents = toCents(range.start);
  const endCents = toCents(range.end);
  const stepCents = toCents(range.step);
  const options: string[] = [];
  for (let c = startCents; c <= endCents; c += stepCents) {
    options.push(fromCents(c));
  }
  return options;
}

// ── Shared numbers-only keystroke validation ────────────────────────────
// Used by both MeasurementDecimalField (the dropdown+free-typing control)
// and CoatDecimalField (the plain Coat/Waistcoat input, which has no
// dropdown at all) — extracted here so the two can never enforce different
// "what counts as a valid number" rules.

/** A valid IN-PROGRESS decimal entry: digits only, with at most one decimal point, anywhere (including a bare "." or a trailing "4." mid-typing). Not a complete-number regex — the user is typically mid-keystroke. Empty string is valid. */
export const VALID_DECIMAL_IN_PROGRESS = /^\d*\.?\d*$/;

/**
 * Mirrors the exact rule every numeric measurement input in this app
 * applies on every change (typed, pasted, autofilled, or drag-dropped —
 * they all produce the same resulting string): trim, test against
 * VALID_DECIMAL_IN_PROGRESS, and either accept the new value or keep
 * whatever was there before. An edit that would produce something outside
 * this shape is simply ignored — never rounded, auto-completed, or
 * otherwise rewritten.
 */
export function sanitizeDecimalKeystroke(previousValue: string, rawNextValue: string): string {
  const next = rawNextValue.trim();
  return VALID_DECIMAL_IN_PROGRESS.test(next) ? next : previousValue;
}
