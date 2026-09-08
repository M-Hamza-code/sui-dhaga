import { z } from "zod";
import { PHONE_REGEX } from "@/lib/phone";

// Extracted (Step 25) into its own plain module — a "use server" file's
// exports must all be async Server Actions, and parseCustomerInput is a
// pure, synchronous validator both customer-actions.ts (createCustomer/
// updateCustomer, unchanged) and the combined new-customer+order action
// (customer-order-actions.ts) need to share rather than duplicate. The
// validation rule itself — name/phonePrimary/phoneSecondary/address — is
// exactly what it has always been since Step 3.
//
// Phase 5 (offline-first) — the schema itself is now also exported
// directly (previously only parseCustomerInput/FormData-shaped access
// was). This is a zero-behavior-change addition: parseCustomerInput's
// own logic is untouched. The new offline sync module (customer-sync.ts)
// and the local-first customer forms both receive plain JSON objects,
// not FormData, so they call this schema's own .safeParse() directly
// instead of adapting JSON into a fake FormData just to keep using
// parseCustomerInput — same validation rule, no second copy of it.
export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  phonePrimary: z
    .string()
    .trim()
    .regex(PHONE_REGEX, "Enter a valid primary phone number"),
  phoneSecondary: z
    .string()
    .trim()
    .regex(PHONE_REGEX, "Enter a valid secondary phone number")
    .optional(),
  address: z.string().trim().max(500, "Address is too long").optional(),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

export function parseCustomerInput(
  formData: FormData
): { success: true; data: CustomerInput } | { success: false; error: string } {
  const parsed = customerInputSchema.safeParse({
    name: formData.get("name"),
    phonePrimary: formData.get("phonePrimary"),
    // Empty optional fields come through as "" from the form — treat them
    // as "not provided" rather than failing the regex.
    phoneSecondary: formData.get("phoneSecondary") || undefined,
    address: formData.get("address") || undefined,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }

  return { success: true, data: parsed.data };
}
