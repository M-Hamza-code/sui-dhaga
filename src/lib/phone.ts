// Shared Pakistani phone-number normalization. The digit-stripping rule
// itself is unchanged from Step 11's customer-search.ts (private
// `normalizePhone` there) — Step 17 pulls it out into its own module
// because customer-search.ts is a `"use server"` Server Actions file
// (only async-action exports are allowed out of one) and the WhatsApp
// deep-link builder needs the same normalization from ordinary
// server/client code, not a second copy of the regex.

// Loose format check for a *stored* phone number (Step 3's customer form,
// now also Step 18's Settings shop phone) — digits/+/-/spaces/parens,
// 7-20 characters. This is deliberately not the same thing as
// normalizePhoneDigits/toWhatsAppPhone above: a stored phone can be a
// landline or otherwise not WhatsApp-capable and still be "valid" here:
// this only rejects obviously-malformed data, it does not require the
// value to be WhatsApp-ready.
export const PHONE_REGEX = /^[0-9+\-\s()]{7,20}$/;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Bare 10-digit local form: "+92 300 1234567", "0300-1234567", and a
 * pasted "3001234567" all normalize to "3001234567". Strips everything
 * but digits, then a leading "92" country code or a leading trunk "0"
 * (never both — a number only ever has one). Identical rule to Step 11's
 * search normalization, so a phone that matches in search also resolves
 * to the same WhatsApp target.
 */
export function normalizePhoneDigits(value: string): string {
  const digits = digitsOnly(value);
  if (digits.startsWith("92")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/**
 * Full international form wa.me links require ("923001234567" — no
 * leading +, no leading 0). Returns null when the input doesn't
 * normalize to a plausible 10-digit Pakistani mobile number, so callers
 * never build a broken WhatsApp link from empty/garbled data.
 */
export function toWhatsAppPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const local = normalizePhoneDigits(value);
  if (local.length !== 10) return null;
  return `92${local}`;
}

/**
 * Picks the first usable WhatsApp target from a customer's phone fields —
 * phonePrimary first, phoneSecondary as a fallback. No new phone fields:
 * these are the only two the Customer model has (Step 3).
 */
export function resolveWhatsAppPhone(customer: { phonePrimary: string; phoneSecondary: string | null }): string | null {
  return toWhatsAppPhone(customer.phonePrimary) ?? toWhatsAppPhone(customer.phoneSecondary);
}
