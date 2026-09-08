// Step 35 — a small, honest, client-side record of "the last time a
// backup/export actually succeeded."
//
// This is deliberately NOT a sync system. The design brief's §9
// "Offline-first" rule (local storage as the source of truth, opportunistic
// server sync) was never built — see the Step 27/34 audits — so there is
// no background reconciliation process anywhere in this app to report a
// status on. Displaying a literal "last sync time" would misrepresent
// something that doesn't exist. What this tracks instead is narrower and
// entirely real: the last time the admin clicked one of the existing
// Backup/Export actions (backup-actions.ts, unchanged) and it actually
// completed — the same underlying "keep the data safe" reassurance the
// brief's backup indicator exists for (§9: "This must be visible, because
// it is what convinces him to stop keeping the paper pad in parallel"),
// without pretending to be something it isn't.
//
// localStorage only, same convention as order-draft-storage.ts. Per-device,
// per-browser: if the browser/device data is ever cleared, this value is
// gone and the indicator simply shows "no backup yet on this device" again
// — never a stale or fabricated time. That is the correct, intended
// behavior for something this lightweight, not a bug to fix.
const LAST_BACKUP_KEY = "sui-dhaga:last-backup-at";

/** Call ONLY after a backup/export action has actually completed successfully. */
export function recordBackupSuccess(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  } catch {
    // Private browsing / storage disabled / quota exceeded — never let a
    // display-only convenience failing affect the download that already
    // succeeded.
  }
}

/** Returns null if no successful backup/export has ever been recorded on this device. */
export function getLastBackupTime(): Date | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
