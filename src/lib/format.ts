const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * "4:12 PM · 30 Aug 2026" — Step 35's "last successful backup" indicator
 * (Settings §6). Reuses formatDate's own day format rather than the
 * mockup's literal numeric "30-08-2026" for internal consistency: every
 * other date on screen (order dates, delivery dates, "created" columns)
 * already renders this same "30 Aug 2026" style via formatDate.
 */
export function formatDateTime(date: Date): string {
  return `${timeFormatter.format(date)} · ${formatDate(date)}`;
}

const moneyFormatter = new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: { toString(): string }): string {
  return `Rs. ${moneyFormatter.format(Number(value.toString()))}`;
}

/**
 * Displays an orderNumber as a bare number ("ORD-000001" -> "1"), per the
 * authoritative mockup — it never shows the "ORD-" prefix anywhere. The
 * underlying stored value and generation logic are untouched; this is
 * display-only, and can be safely revisited once the numbering/display
 * system is reconciled in a later step.
 */
export function formatOrderNumber(orderNumber: string): string {
  const digits = orderNumber.replace(/^ORD-0*/, "");
  return digits || "0";
}

/**
 * Coarse "2 days ago" / "3 weeks ago" style relative time, matching the
 * recency language used throughout the design brief and mockup (search
 * results, saved-measurement age).
 *
 * Accepts a string too: search results reaching this from
 * /api/search/customers arrive as JSON (Date -> ISO string over the
 * wire), while server-rendered pages still pass a real Prisma Date —
 * both are normalized here rather than pushed onto every caller.
 */
export function formatRelativeTime(date: Date | string): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  const diffDays = Math.floor((Date.now() - dateObj.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return diffWeeks === 1 ? "1 week ago" : `${diffWeeks} weeks ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffDays < 365) return diffMonths === 1 ? "1 month ago" : `${diffMonths} months ago`;

  const diffYears = Math.floor(diffDays / 365);
  return diffYears === 1 ? "1 year ago" : `${diffYears} years ago`;
}
