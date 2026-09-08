// Cent-precise decimal-string arithmetic for Order money fields
// (totalAmount, advanceAmount, balanceAmount — all Decimal(10,2) in the
// schema). This is the file prisma/schema.prisma's balanceAmount comment
// points to.
//
// Deliberately never does floating-point math on the amounts themselves —
// every value is converted to integer cents first — so a subtraction like
// "5000.00" - "2000.00" can never drift off the exact cent value.

export const MONEY_REGEX = /^\d{1,8}(\.\d{1,2})?$/;

function toCents(amount: string): number {
  const [wholePart, fractionPart = ""] = amount.split(".");
  const cents = fractionPart.padEnd(2, "0").slice(0, 2);
  return Number(wholePart) * 100 + Number(cents);
}

function fromCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

export function isAdvanceWithinTotal(totalAmount: string, advanceAmount: string): boolean {
  return toCents(advanceAmount) <= toCents(totalAmount);
}

/** balanceAmount = totalAmount - advanceAmount, computed as integer cents. */
export function calculateBalance(totalAmount: string, advanceAmount: string): string {
  return fromCents(toCents(totalAmount) - toCents(advanceAmount));
}
