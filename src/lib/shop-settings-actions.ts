"use server";

// Server Action for the Settings screen (Step 18). ShopSettings has been a
// real singleton row since Step 9; this is its first reader/writer form.
// Follows the same shape every other mutating action in this app already
// uses: requireSession() first, Zod-validate, redirect with ?error= on
// failure, upsert, revalidate, redirect on success.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { MONEY_REGEX } from "@/lib/money";
import { PHONE_REGEX } from "@/lib/phone";
import { SUIT_TYPE_OPTIONS } from "@/lib/order-options";

const settingsInputSchema = z.object({
  name: z.string().trim().min(1, "Shop Name is required").max(120, "Shop Name is too long"),
  // Same loose format as the customer phone fields — but empty is allowed
  // here (the schema column is a required String, not nullable, but an
  // empty string is already how "not configured yet" is represented; see
  // the seeded row from Step 9).
  phone: z.string().trim().refine((v) => v === "" || PHONE_REGEX.test(v), "Enter a valid phone number"),
  address: z.string().trim().max(500, "Address is too long").optional(),
  tagline: z.string().trim().max(200, "Tagline is too long").optional(),
});

const PERCENT_REGEX = /^\d{1,3}(\.\d{1,2})?$/;

/** "" -> no default (null). Otherwise must be a valid 0-100 percentage, matching Decimal(5,2). */
function parseAdvancePercent(raw: string): { value: string | null; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };
  if (!PERCENT_REGEX.test(trimmed)) {
    return { value: null, error: "Default Advance Percentage must be a valid number (e.g. 50 or 33.33)" };
  }
  const n = Number(trimmed);
  if (n < 0 || n > 100) {
    return { value: null, error: "Default Advance Percentage must be between 0 and 100" };
  }
  return { value: trimmed };
}

export async function updateShopSettings(formData: FormData): Promise<void> {
  await requireSession();

  const parsed = settingsInputSchema.safeParse({
    name: formData.get("name") || "",
    phone: formData.get("phone") || "",
    address: formData.get("address") || undefined,
    tagline: formData.get("tagline") || undefined,
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    redirect(`/settings?error=${encodeURIComponent(message)}`);
  }
  const data = parsed.data;

  const percentResult = parseAdvancePercent(String(formData.get("defaultAdvancePercent") ?? ""));
  if (percentResult.error) {
    redirect(`/settings?error=${encodeURIComponent(percentResult.error)}`);
  }

  // Rebuilt field-by-field from individual `price.<SuitType>` inputs —
  // never accepted as one client-supplied JSON blob — exactly the same
  // "never trust arbitrary JSON from the client" rule
  // shop-settings.ts's parseDefaultPrices() enforces on the read side.
  const defaultPrices: Record<string, string> = {};
  const priceErrors: string[] = [];
  for (const option of SUIT_TYPE_OPTIONS) {
    const raw = formData.get(`price.${option.value}`);
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed === "") continue;
    if (!MONEY_REGEX.test(trimmed)) {
      priceErrors.push(`${option.label} price must be a valid non-negative number`);
      continue;
    }
    defaultPrices[option.value] = trimmed;
  }
  if (priceErrors.length > 0) {
    redirect(`/settings?error=${encodeURIComponent(priceErrors.join(" "))}`);
  }

  const values = {
    name: data.name,
    phone: data.phone,
    address: data.address || null,
    tagline: data.tagline || null,
    defaultAdvancePercent: percentResult.value,
    defaultPrices,
  };

  // Singleton safety (Step 9 architecture, unchanged): always keyed by the
  // unique `singleton: true` flag. Updates the existing row if one
  // exists; creates it only for a brand-new install that has never had a
  // ShopSettings row at all. There is no code path that can ever produce
  // a second row — `singleton` being @unique enforces that at the
  // database level even if this ever raced.
  await prisma.shopSettings.upsert({
    where: { singleton: true },
    update: values,
    create: { singleton: true, ...values },
  });

  // The print/WhatsApp preview pages read ShopSettings fresh from Prisma
  // on every request already (they're fully dynamic — requireSession/
  // getSession's cookies() access takes them out of any static/ISR
  // caching), so nothing there can be serving stale data regardless of
  // this call. This only clears Next's client-side router cache for the
  // Settings page itself, so a soft-navigation back to /settings shows
  // the just-saved values immediately rather than a stale prefetch.
  revalidatePath("/settings");

  redirect("/settings?success=1");
}
