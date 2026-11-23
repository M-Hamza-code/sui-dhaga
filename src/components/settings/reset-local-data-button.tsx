"use client";

// One-time, explicit, admin-triggered reset of THIS DEVICE's local app
// data — added specifically because this environment has no way to
// drive the browser's own DevTools (Application tab → Clear site data)
// for the admin, so "clear the browser side" needed a path reachable
// from inside the app itself. This never touches the server/database —
// it only clears what this one browser has stored locally.
//
// Deliberately NOT wired into any automatic flow (no "run this on every
// restore" hook, no scheduled cleanup) — it's a manual, rarely-used
// maintenance action, gated behind an explicit confirm() describing
// exactly what it does and doesn't affect.
//
// Clears, in full:
//   - The whole "sui-dhaga-offline" IndexedDB database (DATABASE_NAME,
//     db.ts) — every local table (customers/measurements/
//     coatMeasurements/measurementSnapshots/orders/orderItems/
//     designOptions/shopSettings) AND the sync queue (syncQueue/
//     syncMeta) in one action, regardless of each queue item's status
//     (pending/sending/failed/synced/conflict) — there is nothing left
//     afterward that could replay or conflict against a freshly reset
//     server.
//   - All of localStorage (the order/measurement/coat-measurement
//     autosave drafts, including the "new"-order draft that isn't tied
//     to any specific customer/order id, plus the last-backup-time
//     hint — the one other known localStorage key, harmless to lose).
//
// Reloads the page afterward so the app re-initializes against a
// genuinely empty local store and re-pulls fresh (now-empty) data from
// the server via the normal initial sync, rather than leaving any
// stale in-memory React state on screen.
import { useState } from "react";
import { DATABASE_NAME, beginLocalDataReset, cancelLocalDataReset, getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { en } from "@/lib/locale";

// Follow-up fix — a real "blocked" outcome (IndexedDB spec: delete stays
// pending until every open connection to this database closes) must
// never be treated as success. The one legitimate, expected source of a
// blocking connection on THIS page is SyncStatusIndicator's own 3-second
// poll reopening Dexie between this click and beginLocalDataReset()
// actually taking effect — closing the known instance again and
// retrying almost always clears that by itself, since no further poll
// can pass isOfflineDbAvailable() once the reset flag is set. If it's
// still blocked after that, it's something this page doesn't control
// (most likely a second tab of the app open elsewhere) — reported
// honestly as a failure, never silently swallowed.
function deleteIndexedDbOnce(name: string): Promise<"success" | "blocked"> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve("success");
    request.onerror = () => reject(request.error ?? new Error("deleteDatabase failed"));
    request.onblocked = () => resolve("blocked");
  });
}

async function deleteIndexedDbWithRetry(name: string): Promise<void> {
  const firstAttempt = await deleteIndexedDbOnce(name);
  if (firstAttempt === "success") return;

  // One retry: close whatever connection exists now (the flag already
  // blocks any NEW one from opening) and wait briefly for the earlier,
  // already-in-flight open to finish and become orphaned, then ask again.
  try {
    getOfflineDb().close();
  } catch {
    // Nothing open — fine.
  }
  await new Promise((r) => setTimeout(r, 300));
  const secondAttempt = await deleteIndexedDbOnce(name);
  if (secondAttempt === "blocked") {
    throw new Error("Deletion is still blocked by another open connection (likely a second tab of this app).");
  }
}

export function ResetLocalDataButton() {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleReset() {
    if (!isOfflineDbAvailable()) {
      setMessage(en.settings.resetLocalDataUnavailable);
      return;
    }
    if (!window.confirm(en.settings.resetLocalDataConfirm)) {
      return;
    }

    setWorking(true);
    setMessage(null);
    // Set BEFORE touching Dexie at all — stops every other mounted
    // component (notably SyncStatusIndicator's poll) from reopening a
    // connection for the rest of this operation. Every existing Dexie
    // call site already guards on isOfflineDbAvailable(), so this alone
    // is enough; no other file needs to change.
    beginLocalDataReset();
    try {
      try {
        getOfflineDb().close();
      } catch {
        // Not open yet — nothing to close.
      }
      await deleteIndexedDbWithRetry(DATABASE_NAME);
      // Only reached once IndexedDB itself reports genuine success — not
      // on "blocked" — so this can never run while the old database (and
      // its old queue entries) still actually exists.
      localStorage.clear();
      setMessage(en.settings.resetLocalDataDone);
      window.location.href = "/overview";
    } catch {
      // Reset did not complete — restore normal Dexie access for the
      // rest of this page's life and say so plainly. Never claim success
      // here; the stale data is still there if this path is reached.
      cancelLocalDataReset();
      setWorking(false);
      setMessage(en.settings.resetLocalDataError);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleReset}
        disabled={working}
        className="rounded-sm border border-red-300 px-4 py-2 text-sm text-red-700 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 disabled:opacity-60"
      >
        {working ? en.settings.resetLocalDataWorking : en.settings.resetLocalDataButton}
      </button>
      {message && (
        <p role="alert" className="mt-2 text-xs text-graphite/70">
          {message}
        </p>
      )}
    </div>
  );
}
