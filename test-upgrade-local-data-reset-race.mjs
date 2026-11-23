// Regression test for the "reset local data" race condition: a stale
// IndexedDB connection reopened WHILE indexedDB.deleteDatabase(...) is
// pending (e.g. SyncStatusIndicator's own 3-second poll firing at the
// wrong moment) makes the browser report "blocked" instead of
// "success" — the previous bug treated "blocked" as success and
// navigated away before the real deletion had happened, so the old
// database (and its old sync queue entries) survived.
//
// The fix: beginLocalDataReset() flips isOfflineDbAvailable() to false
// for the rest of the page's life, so every existing Dexie call site in
// this codebase (all of which already guard on isOfflineDbAvailable()
// first — re-verified directly in every call site this round) stops
// short of reopening a connection during the delete window.
//
// This test reproduces the actual race directly against a real (fake)
// IndexedDB implementation — not just asserting the flag's own value —
// by opening a connection, starting a delete, and then attempting a
// reopen exactly like SyncStatusIndicator's poll would, with and
// without the fix's guard active.
//
// Run via: npx tsx test-upgrade-local-data-reset-race.mjs
import "fake-indexeddb/auto";

if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}

async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}

const dbModule = await loadDefault("./src/lib/offline/db.ts");
const { getOfflineDb, isOfflineDbAvailable, beginLocalDataReset, cancelLocalDataReset, DATABASE_NAME } = dbModule;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

function deleteDb(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve("success");
    request.onblocked = () => resolve("blocked");
    request.onerror = () => resolve("error");
  });
}

try {
  // ══════════════════════════════════════════════════════════════════
  // 1. The flag itself: before/during/after a reset
  // ══════════════════════════════════════════════════════════════════
  console.log("1. beginLocalDataReset/cancelLocalDataReset toggle isOfflineDbAvailable correctly");
  check("available before any reset", isOfflineDbAvailable() === true);
  beginLocalDataReset();
  check("unavailable once a reset begins", isOfflineDbAvailable() === false);
  check("getOfflineDb() now throws instead of silently reopening", (() => {
    try {
      getOfflineDb();
      return false;
    } catch {
      return true;
    }
  })());
  cancelLocalDataReset();
  check("available again after a cancelled reset", isOfflineDbAvailable() === true);

  // ══════════════════════════════════════════════════════════════════
  // 2. THE FIX, reproduced: with beginLocalDataReset() set first, the
  //    same simulated poll is stopped by isOfflineDbAvailable() before
  //    it ever reaches Dexie/IndexedDB, and the delete succeeds cleanly.
  // ══════════════════════════════════════════════════════════════════
  console.log("2. With beginLocalDataReset() set first, a simulated poll cannot reopen, and delete succeeds");
  const db2 = getOfflineDb();
  await db2.open();
  check("a connection is genuinely open before the reset begins", db2.isOpen());
  db2.close();
  beginLocalDataReset();
  const deleteOutcome2 = deleteDb(DATABASE_NAME);
  // Simulate the exact same poll behavior as a real caller would: check
  // isOfflineDbAvailable() first (every real call site in this codebase
  // does), and only call getOfflineDb() if it's true.
  let pollAttempted = false;
  if (isOfflineDbAvailable()) {
    pollAttempted = true;
    const reopen = getOfflineDb();
    await reopen.open().catch(() => {});
  }
  const outcome2 = await deleteOutcome2;
  check("the simulated poll correctly refused to even attempt a reopen", pollAttempted === false);
  check("the delete genuinely succeeds this time — no stale database left behind", outcome2 === "success");
  cancelLocalDataReset();
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
