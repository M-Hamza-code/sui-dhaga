// Step 29 — the one post-save destination shared by createOrder
// (order-actions.ts) and createCustomerAndOrder (customer-order-actions.ts).
//
// Per the authoritative design brief/mockup (audited in Step 27), a saved
// order's next screen is always S5 Print Preview — the mockup's own S5
// section has no branch on how the order was saved, and its "Send on
// WhatsApp" action is a button on that screen, not an automatic redirect
// away from it. Step 24's sendOnWhatsApp checkbox previously sent the
// browser straight to /whatsapp (skipping S5 entirely) when checked; that
// conflicted with S5 being the required, unconditional landing screen, so
// this now always lands on S5. The checkbox's own value survives as a
// `?whatsapp=1` query flag, which print-preview/page.tsx reads to decide
// whether to visually emphasize its "Send on WhatsApp" action — see that
// file's own comment for the full reasoning. Nothing here writes to the
// database or changes what was already saved; this only picks the next URL.
export function printPreviewUrl(customerId: string, orderId: string, sendOnWhatsApp: boolean): string {
  return `/customers/${customerId}/orders/${orderId}/print-preview${sendOnWhatsApp ? "?whatsapp=1" : ""}`;
}
