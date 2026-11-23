// localStorage autosave for the Coat/Waistcoat measurement form — mirrors
// measurement-draft-storage.ts exactly (separate module, same reasoning:
// the shared part is three six-line localStorage wrappers, not worth a
// generalization that risks the working Kameez/Shalwar flow).
"use client";

const PREFIX = "sui-dhaga:coat-measurement-draft:";

export interface CoatMeasurementDraft {
  values: Record<string, string>;
  note: string;
}

function key(customerId: string): string {
  return `${PREFIX}${customerId}`;
}

export function loadCoatMeasurementDraft(customerId: string): CoatMeasurementDraft | null {
  try {
    const raw = window.localStorage.getItem(key(customerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoatMeasurementDraft;
    if (!parsed || typeof parsed !== "object" || typeof parsed.values !== "object" || parsed.values === null) {
      return null;
    }
    return { values: parsed.values, note: typeof parsed.note === "string" ? parsed.note : "" };
  } catch {
    return null;
  }
}

export function saveCoatMeasurementDraft(customerId: string, draft: CoatMeasurementDraft): void {
  try {
    window.localStorage.setItem(key(customerId), JSON.stringify(draft));
  } catch {
    // Best-effort only.
  }
}

export function clearCoatMeasurementDraft(customerId: string): void {
  try {
    window.localStorage.removeItem(key(customerId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
