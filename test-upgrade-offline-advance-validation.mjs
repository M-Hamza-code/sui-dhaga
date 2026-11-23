// Regression test for the follow-up audit's "offline advance-payment
// validation" finding: enqueueCreateOrder/enqueueUpdateOrder
// (src/lib/offline/sync-engine.ts) now also reject an advance amount
// greater than the total locally, via the existing isAdvanceWithinTotal()
// helper (src/lib/money.ts) — the exact same rule order-actions.ts
// already enforces server-side (order-actions.ts:333-335) — instead of
// only catching malformed numbers and letting an over-advance order
// queue, sync, and fail server-side later.
//
// Imports the REAL production module directly via `tsx` — not a
// hand-copy. Uses fake-indexeddb (already a devDependency, added for
// test-upgrade-offline-storage-error-handling.mjs) so Dexie has a real
// IndexedDB to run against under Node.
//
// Run via: npx tsx test-upgrade-offline-advance-validation.mjs
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

function buildOrderFormData(totalAmount, advanceAmount) {
  const fd = new FormData();
  fd.set("orderDate", new Date().toISOString().slice(0, 10));
  fd.set("totalAmount", totalAmount);
  fd.set("advanceAmount", advanceAmount);
  fd.set("kameezQuantity", "0");
  return fd;
}

try {
  const db = getOfflineDb();
  await db.open();
  const customer = await enqueueCreateCustomer({ name: "Advance Test Customer", phonePrimary: "03009998888", phoneSecondary: "", address: "" });

  // ══════════════════════════════════════════════════════════════════
  // 1. enqueueCreateOrder: advance > total is rejected locally
  // ══════════════════════════════════════════════════════════════════
  console.log("1. enqueueCreateOrder: advance greater than total is rejected before any local write");
  const countBefore1 = (await db.orders.toArray()).length;
  const over = await enqueueCreateOrder(customer.id, buildOrderFormData("1000.00", "1500.00"));
  check("rejected with queued:false", over.queued === false);
  check("reason is invalid-input", over.reason === "invalid-input");
  check("message matches the server's own wording exactly", over.message === "Advance Amount cannot exceed Total Amount");
  const countAfter1 = (await db.orders.toArray()).length;
  check("no local order row was created by the rejected attempt", countAfter1 === countBefore1);

  // ══════════════════════════════════════════════════════════════════
  // 2. enqueueCreateOrder: advance exactly equal to total is accepted
  //    (a real, common case — paid in full up front; the rule is <=)
  // ══════════════════════════════════════════════════════════════════
  console.log("2. enqueueCreateOrder: advance equal to total (paid in full) is accepted");
  const equalResult = await enqueueCreateOrder(customer.id, buildOrderFormData("2000.00", "2000.00"));
  check("accepted (queued:true)", equalResult.queued === true && typeof equalResult.id === "string");

  // ══════════════════════════════════════════════════════════════════
  // 3. enqueueCreateOrder: advance less than total is accepted (baseline,
  //    unchanged behavior)
  // ══════════════════════════════════════════════════════════════════
  console.log("3. enqueueCreateOrder: advance less than total is accepted (unchanged baseline)");
  const normalOrder = await enqueueCreateOrder(customer.id, buildOrderFormData("3000.00", "1000.00"));
  check("accepted (queued:true)", normalOrder.queued === true && typeof normalOrder.id === "string");

  // ══════════════════════════════════════════════════════════════════
  // 4. enqueueUpdateOrder: the same three checks, on an existing order
  // ══════════════════════════════════════════════════════════════════
  console.log("4. enqueueUpdateOrder: the same contract applies when editing an existing order");
  const overUpdate = await enqueueUpdateOrder(customer.id, normalOrder.id, buildOrderFormData("3000.00", "5000.00"));
  check("rejected with queued:false", overUpdate.queued === false);
  check("reason is invalid-input", overUpdate.reason === "invalid-input");
  check("message matches the server's own wording exactly", overUpdate.message === "Advance Amount cannot exceed Total Amount");

  const orderBeforeFailedUpdate = await db.orders.get(normalOrder.id);
  check("the rejected update did not touch the order's existing stored amounts", orderBeforeFailedUpdate.advanceAmount === "1000.00");

  const equalUpdate = await enqueueUpdateOrder(customer.id, normalOrder.id, buildOrderFormData("3000.00", "3000.00"));
  check("advance equal to total is accepted on update too", equalUpdate.queued === true);

  const validUpdate = await enqueueUpdateOrder(customer.id, normalOrder.id, buildOrderFormData("3000.00", "500.00"));
  check("a normal, smaller advance is accepted on update (unchanged baseline)", validUpdate.queued === true);

  // ══════════════════════════════════════════════════════════════════
  // 5. The pre-existing MONEY_REGEX malformed-number check still fires
  //    independently and first, unaffected by the new rule
  // ══════════════════════════════════════════════════════════════════
  console.log("5. Malformed-number rejection is unaffected by the new rule");
  const malformed = await enqueueCreateOrder(customer.id, buildOrderFormData("1000.00", "abc"));
  check("still rejected as invalid-input with the original malformed-number message", malformed.queued === false && malformed.message === "Total and Advance Amount must be valid non-negative numbers");
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
