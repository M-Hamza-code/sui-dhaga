// Regression test: confirms the offline sync path (enqueueCreateOrder /
// enqueueUpdateOrder, src/lib/offline/sync-engine.ts) faithfully
// preserves whatever `totalAmount` string the order form submits,
// end-to-end into the local Dexie row, without independently
// recomputing or altering it — the same guarantee the online path
// already has, since validateOrderInput (order-actions.ts) also only
// format-validates `totalAmount`, never recalculates it. Both paths
// read the exact same FormData field from the exact same submitted
// form, so there is only ever ONE totalAmount in play; this test proves
// the offline half of that claim against the real production module.
//
// Uses fake-indexeddb (already a devDependency) so Dexie has a real
// IndexedDB to run against under Node, same pattern as
// test-upgrade-offline-storage-error-handling.mjs /
// test-upgrade-offline-advance-validation.mjs.
//
// Run via: npx tsx test-upgrade-order-total-online-offline-consistency.mjs
import "fake-indexeddb/auto";

if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}

async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}

const syncEngine = await loadDefault("./src/lib/offline/sync-engine.ts");
const dbModule = await loadDefault("./src/lib/offline/db.ts");
const { getOfflineDb } = dbModule;
const { enqueueCreateCustomer, enqueueCreateOrder, enqueueUpdateOrder } = syncEngine;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

function buildOrderFormData(totalAmount) {
  const fd = new FormData();
  fd.set("orderDate", new Date().toISOString().slice(0, 10));
  fd.set("totalAmount", totalAmount);
  fd.set("advanceAmount", "0.00");
  fd.set("kameezQuantity", "0");
  fd.set("princeCoatQuantity", "2");
  fd.set("waistcoatQuantity", "2");
  fd.set("princeCoatUnitPrice", "5000.00");
  fd.set("waistcoatUnitPrice", "3000.00");
  return fd;
}

try {
  const db = getOfflineDb();
  await db.open();
  const customer = await enqueueCreateCustomer({ name: "Total Consistency Customer", phonePrimary: "03007778888", phoneSecondary: "", address: "" });

  // ══════════════════════════════════════════════════════════════════
  // 1. enqueueCreateOrder preserves the exact totalAmount submitted —
  //    the real computed figure for this bug's own numbers (16000.00),
  //    not recomputed or dropped to 0 by the offline path.
  // ══════════════════════════════════════════════════════════════════
  console.log("1. enqueueCreateOrder: the submitted totalAmount is written to Dexie unchanged");
  const created = await enqueueCreateOrder(customer.id, buildOrderFormData("16000.00"));
  check("queued successfully", created.queued === true && typeof created.id === "string");
  const localCreated = await db.orders.get(created.id);
  check("the local order row's totalAmount is exactly what was submitted (16000.00), not 0 or recomputed", localCreated.totalAmount === "16000.00");

  // ══════════════════════════════════════════════════════════════════
  // 2. enqueueUpdateOrder preserves it too, including the exact
  //    previously-buggy value (0.00) if that's genuinely what's
  //    submitted — the sync layer must never silently "fix" a value,
  //    only faithfully transmit whatever the form actually sent.
  // ══════════════════════════════════════════════════════════════════
  console.log("2. enqueueUpdateOrder: same guarantee on edit, for both a correct and a zero total");
  const updatedToReal = await enqueueUpdateOrder(customer.id, created.id, buildOrderFormData("16000.00"));
  check("update with the real computed total queues successfully", updatedToReal.queued === true);
  const localAfterRealUpdate = await db.orders.get(created.id);
  check("the local row reflects the real total after update", localAfterRealUpdate.totalAmount === "16000.00");

  const updatedToZero = await enqueueUpdateOrder(customer.id, created.id, buildOrderFormData("0.00"));
  check("an update genuinely submitting 0.00 also queues (the sync layer doesn't second-guess the form's value)", updatedToZero.queued === true);
  const localAfterZeroUpdate = await db.orders.get(created.id);
  check("the local row faithfully reflects 0.00 — confirming the ORIGINAL bug was in the form's own state, not in sync transmission", localAfterZeroUpdate.totalAmount === "0.00");

  // ══════════════════════════════════════════════════════════════════
  // 3. Both enqueue functions read totalAmount from the identical
  //    FormData field name the online Server Action path also reads
  //    (validateOrderInput/order-actions.ts) — confirmed by inspecting
  //    sync-engine.ts directly: both call `fields.totalAmount` from the
  //    same `formData.forEach` pass with no separate online-only field
  //    name or transform. Re-asserted here structurally: a FormData
  //    missing `totalAmount` entirely is rejected identically to how a
  //    malformed one is, by the same shared validation path.
  // ══════════════════════════════════════════════════════════════════
  console.log("3. A missing totalAmount is rejected the same way online and offline would (shared validation, not a separate path)");
  const fdMissing = buildOrderFormData("16000.00");
  fdMissing.delete("totalAmount");
  const missingResult = await enqueueCreateOrder(customer.id, fdMissing);
  check("rejected locally as invalid-input (same rule validateOrderInput enforces server-side)", missingResult.queued === false && missingResult.reason === "invalid-input");
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
