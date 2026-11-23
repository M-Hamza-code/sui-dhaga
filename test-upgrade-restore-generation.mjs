// Regression test for the offline-device restore-generation handling
// (Requirement 10) — shouldReconfirmPendingDeletes(), the pure decision
// rule initial-sync.ts uses to decide whether a restore happened since
// this device's last pull and every still-pending DELETE_ORDER needs
// manual reconfirmation before being sent again.
//
// Pure logic only, imported directly via `tsx` from the real module —
// the actual Dexie write this rule triggers (marking queue items
// dispatchBlocked inside runInitialSync()'s transaction) can only be
// exercised inside a real browser's IndexedDB, same documented
// limitation as every other Dexie-write behavior in this project (see
// /dev/sync-check's own header comment) — not re-claimed as tested here.
//
// Run via: npx tsx test-upgrade-restore-generation.mjs
async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}
const { shouldReconfirmPendingDeletes } = await loadDefault("./src/lib/offline/initial-sync.ts");

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

console.log("shouldReconfirmPendingDeletes — the restore-generation comparison rule");
check("never seen a generation before (undefined) -> no reconfirmation needed, nothing to compare against", shouldReconfirmPendingDeletes(undefined, 3) === false);
check("same generation as last seen -> no restore happened -> no reconfirmation needed", shouldReconfirmPendingDeletes(5, 5) === false);
check("server generation advanced since last seen -> a restore happened -> reconfirmation needed", shouldReconfirmPendingDeletes(5, 6) === true);
check("generation at 0 on both sides (brand new install, never restored) -> no reconfirmation needed", shouldReconfirmPendingDeletes(0, 0) === false);
check("stored generation somehow higher than server's (should not happen, but must not crash) -> still correctly flags a mismatch", shouldReconfirmPendingDeletes(7, 2) === true);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
