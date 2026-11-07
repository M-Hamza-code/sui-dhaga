// localStorage autosave for the measurement form.
//
// The design brief's own reasoning for autosaving the ORDER form applies
// at least as strongly here — "a browser crash mid-measurement with a
// customer standing there is the worst possible failure" is literally
// about measurements. The order form has had this since Step 14
// (order-draft-storage.ts); the measurement form never did, so sixteen
// hand-typed measurements were lost silently on a crash, an accidental
// Back, or a closed tab.
//
// Deliberately a parallel module rather than a generalisation of
// order-draft-storage.ts: that file is load-bearing for the order flow,
// and the shared part is three six-line localStorage wrappers. Keeping
// them separate costs a little duplication and risks nothing in a working
// flow. Both use the same conventions, so they stay easy to read together:
//   - never touches the database — no server round trip, no Server Action
//   - customer-scoped, so two customers' in-progress measurements can
//     never bleed into each other
//   - stores nothing but the form's own field values — no session token,
//     password, or other credential ever passes through here
//   - cleared the instant the measurement is actually submitted, so a
//     stale draft can never resurface over a value that was really saved
"use client";

const PREFIX = "sui-dhaga:measurement-draft:";

/**
 * What gets persisted: the DISPLAY values (fraction glyphs included,
 * exactly as shown in the inputs) plus the note. Storing the display form
 * rather than decimals means a restored draft looks identical to what the
 * user had typed, with no re-formatting round trip.
 */
export interface MeasurementDraft {
  values: Record<string, string>;
  note: string;
}

function key(customerId: string): string {
  return `${PREFIX}${customerId}`;
}

export function loadMeasurementDraft(customerId: string): MeasurementDraft | null {
  try {
    const raw = window.localStorage.getItem(key(customerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MeasurementDraft;
    // Shape-check before trusting it: a draft written by an older version
    // of this form (or hand-edited storage) must read as "no draft"
    // rather than putting undefined into the inputs.
    if (!parsed || typeof parsed !== "object" || typeof parsed.values !== "object" || parsed.values === null) {
      return null;
    }
    return { values: parsed.values, note: typeof parsed.note === "string" ? parsed.note : "" };
  } catch {
    // Corrupt JSON, storage disabled, or a private-browsing quota error —
    // treat exactly like "no draft" rather than surfacing an error to an
    // owner standing at the counter with a customer.
    return null;
  }
}

export function saveMeasurementDraft(customerId: string, draft: MeasurementDraft): void {
  try {
    window.localStorage.setItem(key(customerId), JSON.stringify(draft));
  } catch {
    // Best-effort only — a full/blocked localStorage must never break the
    // form itself.
  }
}

export function clearMeasurementDraft(customerId: string): void {
  try {
    window.localStorage.removeItem(key(customerId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
