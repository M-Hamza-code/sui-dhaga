// Regression test for the "online order creates failed sync queue
// entries" bug: an order created together with a brand-new customer
// (order-form.tsx's createCustomerAndOrder Server Action, mode="new")
// is a plain online write — it never calls enqueueCreateOrder(), so the
// local Dexie `orders` table never gets a row for it until the next
// full page load's initial-sync pull. A subsequent status change via
// the normal OrderStatusForm UI would previously queue an
// UPDATE_ORDER_STATUS item anyway (the local write was a silent Dexie
// no-op), which could only ever fail — permanently, with no retry — the
// first time it was actually dispatched, because
// prepareItemForDispatch()'s own baseline check
// (readLiveBaseline/missing-record) correctly refuses to proceed
// without a real local baseline.
//
// The fix: enqueueOrderStatusUpdate() now checks for a usable local
// baseline BEFORE ever queuing anything, so this exact scenario fails
// immediately and visibly instead of being queued and failing much
// later, permanently, with no way back except manual intervention.
//
// Imports the REAL production module directly via `tsx`. Uses
// fake-indexeddb so Dexie has a real IndexedDB to run against under
// Node — no live Next.js server needed for this test, since the bug and
// its fix are both entirely about LOCAL Dexie state, never about the
// network response shape.
//
// Run via: npx tsx test-upgrade-order-status-unknown-baseline.mjs
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
const { enqueueCreateCustomer, enqueueCreateOrder, enqueueOrderStatusUpdate } = syncEngine;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

try {
  const db = getOfflineDb();
  await db.open();

  // ══════════════════════════════════════════════════════════════════
  // 1. THE BUG SCENARIO: an order that exists only because of a plain
  //    online write (createCustomerAndOrder) — simulated here exactly
  //    as it really happens: NO call to enqueueCreateCustomer/
  //    enqueueCreateOrder at all, so the local `orders` table has no
  //    row whatsoever for this id. Insert the row directly to stand in
  //    for "the server has this order, but this browser's local mirror
  //    has never heard of it."
  // ══════════════════════════════════════════════════════════════════
  console.log("1. Status change on an order with NO local Dexie row at all (the real bug scenario)");
  const neverLocallyKnownOrderId = "simulated-online-only-order-id";
  check("confirmed: no local row exists for this order", (await db.orders.get(neverLocallyKnownOrderId)) === undefined);

  const result1 = await enqueueOrderStatusUpdate({ customerId: "whatever-customer-id", orderId: neverLocallyKnownOrderId, status: "STITCHING" });
  check("rejected immediately with queued:false", result1.queued === false);
  check("reason is the new unknown-baseline, not silently queued", result1.reason === "unknown-baseline");
  check("message tells the admin exactly what to do", result1.message === "This order hasn't finished loading on this device yet. Please refresh the page and try again.");

  const queueAfter1 = await db.syncQueue.toArray();
  check("no queue item was created — nothing left behind to fail later", queueAfter1.length === 0);

  // ══════════════════════════════════════════════════════════════════
  // 2. A local row that exists but has never synced (baseUpdatedAt
  //    still null) — e.g. CREATE_ORDER itself hasn't completed yet.
  //    Same rejection, same reasoning: there's no confirmed baseline to
  //    protect against overwriting yet.
  // ══════════════════════════════════════════════════════════════════
  console.log("2. Status change on a local row that exists but has never synced (baseUpdatedAt still null)");
  const customer = await enqueueCreateCustomer({ name: "Baseline Test Customer", phonePrimary: "03001231234", phoneSecondary: "", address: "" });
  const fd = new FormData();
  fd.set("orderDate", new Date().toISOString().slice(0, 10));
  fd.set("totalAmount", "1000.00");
  fd.set("advanceAmount", "0.00");
  fd.set("kameezQuantity", "0");
  const created = await enqueueCreateOrder(customer.id, fd);
  check("order created locally (not yet synced)", created.queued === true);
  const localRowBeforeSync = await db.orders.get(created.id);
  check("confirmed: baseUpdatedAt is still null before any sync", localRowBeforeSync.baseUpdatedAt === null);

  const result2 = await enqueueOrderStatusUpdate({ customerId: customer.id, orderId: created.id, status: "STITCHING" });
  check("also rejected with unknown-baseline (correctly, not a false positive)", result2.queued === false && result2.reason === "unknown-baseline");

  // ══════════════════════════════════════════════════════════════════
  // 3. Once the order has a real, confirmed baseline (simulating
  //    CREATE_ORDER's own success handler having run), status changes
  //    proceed normally — the fix doesn't block the legitimate case.
  // ══════════════════════════════════════════════════════════════════
  console.log("3. Once the order has a real confirmed baseline, status changes work normally");
  const serverConfirmedUpdatedAt = new Date().toISOString();
  await db.orders.update(created.id, { updatedAt: serverConfirmedUpdatedAt, baseUpdatedAt: serverConfirmedUpdatedAt, syncStatus: "synced" });

  const result3 = await enqueueOrderStatusUpdate({ customerId: customer.id, orderId: created.id, status: "STITCHING" });
  check("accepted normally now that a real baseline exists", result3.queued === true);
  const queueAfter3 = await db.syncQueue.toArray();
  const statusItem3 = queueAfter3.find((i) => i.op === "UPDATE_ORDER_STATUS" && i.payload.status === "STITCHING");
  check("the status-change queue item exists, carrying the real baseline", statusItem3?.payload.baseUpdatedAt === serverConfirmedUpdatedAt);

  // ══════════════════════════════════════════════════════════════════
  // 4. Repeated status changes to the same order — each one reads the
  //    CURRENT local baseline at its own enqueue time (matching what
  //    prepareItemForDispatch will separately re-resolve at dispatch
  //    time), never a stale or fabricated value.
  // ══════════════════════════════════════════════════════════════════
  console.log("4. Repeated status changes read the current baseline each time, never a stale one");
  // Simulate the first status change's own success (advancing baseUpdatedAt, same as the real success handler does).
  const afterFirstStatusSync = new Date(Date.now() + 1000).toISOString();
  await db.orders.update(created.id, { updatedAt: afterFirstStatusSync, baseUpdatedAt: afterFirstStatusSync, syncStatus: "synced" });

  const result4 = await enqueueOrderStatusUpdate({ customerId: customer.id, orderId: created.id, status: "READY" });
  check("second status change accepted", result4.queued === true);
  const queueAfter4 = await db.syncQueue.toArray();
  const secondItem = queueAfter4.find((i) => i.op === "UPDATE_ORDER_STATUS" && i.payload.status === "READY");
  check("the second change's payload carries the NEWLY advanced baseline, not the original one", secondItem?.payload.baseUpdatedAt === afterFirstStatusSync);

  // Cleanup
  await db.syncQueue.clear();
  await db.orders.delete(created.id);
  await db.customers.delete(customer.id);
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
