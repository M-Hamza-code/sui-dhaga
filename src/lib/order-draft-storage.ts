// localStorage autosave for the S3 Order form (Step 14, design brief §9:
// "Autosave the order form every few seconds. A browser crash mid-
// measurement with a customer standing there is the worst possible
// failure."). This is purely a client-side convenience:
//   - never touches the database — no server round trip, no Server Action
//   - customer-scoped, so two different customers' in-progress orders can
//     never bleed into each other or be confused for one another
//   - stores nothing except the order form's own field values — no
//     session token, password, or any other credential ever passes through
//     here
//   - cleared the instant the order is actually submitted, so a stale
//     draft can never resurface for an order that already exists
"use client";

const PREFIX = "sui-dhaga:order-draft:";

function key(customerId: string): string {
  return `${PREFIX}${customerId}`;
}

export function loadOrderDraft<T>(customerId: string): T | null {
  try {
    const raw = window.localStorage.getItem(key(customerId));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt JSON, storage disabled, or a private-browsing quota error —
    // treat exactly like "no draft" rather than surfacing an error to an
    // owner who is standing at the counter with a customer.
    return null;
  }
}

export function saveOrderDraft<T>(customerId: string, draft: T): void {
  try {
    window.localStorage.setItem(key(customerId), JSON.stringify(draft));
  } catch {
    // Best-effort only — a full/blocked localStorage must never break the
    // form itself.
  }
}

export function clearOrderDraft(customerId: string): void {
  try {
    window.localStorage.removeItem(key(customerId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
