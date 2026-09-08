// Fraction glyph display/parsing for measurement values (Step 13).
//
// The database and saveMeasurement's validation are UNCHANGED — a
// measurement is still stored and submitted as a plain decimal string
// ("45.50"). This module only converts between that decimal string and
// the fraction-glyph string shown on screen ("45½"), so the UI never
// displays raw decimal notation for the three canonical fractions the
// brief calls out, while the server-side contract stays exactly as it
// was in Step 5.

/**
 * "45.50"/"45.5" -> "45½", "45.25" -> "45¼", "45.75" -> "45¾",
 * "45.00"/"45" -> "45". Anything else (a decimal that isn't one of these
 * three canonical fractions) is left as-is — the brief only ever shows
 * ½ ¼ ¾ on the reference slip, so no other glyph is invented here.
 */
export function toFractionDisplay(decimalValue: string | null | undefined): string {
  if (decimalValue === null || decimalValue === undefined) return "";
  const trimmed = String(decimalValue).trim();
  if (trimmed === "") return "";

  return trimmed
    .replace(/\.75$/, "¾")
    .replace(/\.50$/, "½")
    .replace(/\.5$/, "½")
    .replace(/\.25$/, "¼")
    .replace(/\.00$/, "")
    .replace(/\.0$/, "");
}

/**
 * The exact inverse, used right before a value is submitted: "45½" ->
 * "45.5", "45¼" -> "45.25", "45¾" -> "45.75". Passes anything else
 * (plain numbers, or a decimal the user typed directly) straight through
 * unchanged, so the existing DECIMAL_REGEX in measurement-actions.ts
 * keeps validating exactly what it always has.
 */
export function fractionDisplayToDecimal(displayValue: string): string {
  return displayValue.replace(/½/g, ".5").replace(/¼/g, ".25").replace(/¾/g, ".75");
}
