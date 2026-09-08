// WhatsApp message templates and deep-link building (Step 17). Honest
// deep-link workflow, not a WhatsApp Business API integration: this
// module only ever builds a wa.me URL with a pre-filled message. Nothing
// here sends anything — the tailor presses send himself, inside
// WhatsApp, after reviewing/editing the text this produces.
//
// All values consumed here are pre-formatted strings (formatMoney(),
// formatDate(), formatOrderNumber() — already applied by the caller) so
// this module never re-implements or diverges from those existing
// formatting conventions.
//
// Step 37 — the four templates' prose is Urdu (design brief §9: "The
// message body itself is Urdu — the customer reads it, not the owner").
// Only the surrounding sentence text changed to Urdu; every dynamic value
// (customerName, order number, dates, money) is still whatever the
// existing shared formatters already produce — customer names stay Roman
// script (brief §2: "Customer names are typed and stored in Roman
// script"), dates/money stay exactly as formatDate()/formatMoney()
// already render them (Latin digits, "Rs." prefix — brief §2 also
// requires Latin digits everywhere, including on Urdu print/output).
// This mixes Urdu prose with Latin-script values inline, the same way
// real Urdu business messages ordinarily do — no bidi markup is needed
// here because this is plain text handed to wa.me, not HTML rendered by
// this app; WhatsApp's own renderer applies standard Unicode
// bidi handling. "تاریخ واپسی" (delivery date) reuses the exact term
// already established on the Karigar Work Order print
// (work-order-style-labels.ts) rather than inventing a second phrase for
// the same thing.
import type { OrderStatus } from "@prisma/client";
import { getTodayRange } from "@/lib/date-range";

export type WhatsAppTemplateId = "confirmation" | "ready" | "reminder" | "delivered";

export const WHATSAPP_TEMPLATE_IDS: readonly WhatsAppTemplateId[] = ["confirmation", "ready", "reminder", "delivered"];

export interface WhatsAppMessageData {
  customerName: string;
  shopName: string;
  shopAddress: string | null;
  shopPhone: string | null;
  orderNumberDisplay: string;
  orderDateFormatted: string;
  deliveryDateFormatted: string | null;
  totalFormatted: string;
  advanceFormatted: string;
  balanceFormatted: string;
  balanceIsZero: boolean;
}

/**
 * Status-aware default template (Part 6). READY and DELIVERED are always
 * unambiguous. Otherwise (NEW / STITCHING / legacy PENDING), an order
 * whose delivery date has already arrived or passed defaults to the
 * Delivery Reminder template instead of Order Confirmation — the same
 * "due today or overdue" boundary the Order Board (Step 15) already
 * uses, via the same shared getTodayRange() helper, so the two screens
 * never disagree about what counts as due.
 */
export function getDefaultWhatsAppTemplate(status: OrderStatus, deliveryDate: Date | null): WhatsAppTemplateId {
  if (status === "DELIVERED") return "delivered";
  if (status === "READY") return "ready";
  if (deliveryDate) {
    const { end: tomorrowStart } = getTodayRange();
    if (deliveryDate.getTime() < tomorrowStart.getTime()) return "reminder";
  }
  return "confirmation";
}

function balanceLine(d: WhatsAppMessageData, prefix: string): string {
  return d.balanceIsZero ? "" : `${prefix}: ${d.balanceFormatted}\n`;
}

// Urdu label reused across every template that shows a balance line —
// kept as one constant so the wording can't drift between templates.
const BALANCE_DUE_UR = "باقی رقم";

function shopContactLine(d: WhatsAppMessageData): string {
  const parts = [d.shopAddress, d.shopPhone].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? `${parts.join(", ")}\n` : "";
}

function confirmationTemplate(d: WhatsAppMessageData): string {
  return (
    `السلام علیکم ${d.customerName}،\n\n` +
    `${d.shopName} میں آپ کے آرڈر کا شکریہ۔\n\n` +
    `آرڈر نمبر: ${d.orderNumberDisplay}\n` +
    `آرڈر کی تاریخ: ${d.orderDateFormatted}\n` +
    (d.deliveryDateFormatted ? `تاریخ واپسی: ${d.deliveryDateFormatted}\n` : "") +
    `\n` +
    `کل رقم: ${d.totalFormatted}\n` +
    `ایڈوانس: ${d.advanceFormatted}\n` +
    `${BALANCE_DUE_UR}: ${d.balanceFormatted}\n\n` +
    `تیار ہوتے ہی آپ کو اطلاع دی جائے گی۔`
  );
}

function readyTemplate(d: WhatsAppMessageData): string {
  return (
    `السلام علیکم ${d.customerName}،\n\n` +
    `خوشخبری — ${d.shopName} میں آپ کا آرڈر نمبر ${d.orderNumberDisplay} تیار ہو چکا ہے۔\n\n` +
    balanceLine(d, BALANCE_DUE_UR) +
    shopContactLine(d) +
    `براہ کرم اپنی سہولت کے مطابق تشریف لائیں۔`
  );
}

function reminderTemplate(d: WhatsAppMessageData): string {
  return (
    `السلام علیکم ${d.customerName}،\n\n` +
    `یہ یاد دہانی ہے کہ ${d.shopName} میں آپ کے آرڈر نمبر ${d.orderNumberDisplay} کی` +
    (d.deliveryDateFormatted ? ` تاریخ واپسی ${d.deliveryDateFormatted} ہے` : ` واپسی کا وقت ہو گیا ہے`) +
    `۔\n\n` +
    balanceLine(d, BALANCE_DUE_UR) +
    `شکریہ!`
  );
}

function deliveredTemplate(d: WhatsAppMessageData): string {
  return (
    `السلام علیکم ${d.customerName}،\n\n` +
    `${d.shopName} کو منتخب کرنے کا شکریہ۔ آپ کا آرڈر نمبر ${d.orderNumberDisplay} آپ کے حوالے کر دیا گیا ہے۔\n\n` +
    (d.balanceIsZero
      ? `آپ کی ادائیگی مکمل ہو چکی ہے۔\n\n`
      : `${d.balanceFormatted} کی رقم ابھی باقی ہے۔\n\n`) +
    `امید ہے آپ دوبارہ تشریف لائیں گے!`
  );
}

export function buildWhatsAppMessage(templateId: WhatsAppTemplateId, data: WhatsAppMessageData): string {
  switch (templateId) {
    case "confirmation":
      return confirmationTemplate(data);
    case "ready":
      return readyTemplate(data);
    case "reminder":
      return reminderTemplate(data);
    case "delivered":
      return deliveredTemplate(data);
  }
}

/**
 * A real wa.me deep link — properly URL-encoded, never manual string
 * concatenation. `phone` must already be in wa.me's expected form (see
 * phone.ts's toWhatsAppPhone) — this function does not itself validate or
 * reformat it.
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
