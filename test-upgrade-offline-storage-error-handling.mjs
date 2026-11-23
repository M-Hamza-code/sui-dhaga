// Regression test for the final data-safety audit's §3.5 Critical
// finding: every `enqueue*` function in src/lib/offline/sync-engine.ts
// now wraps its `db.transaction(...)` call in try/catch, returning
// `{queued:false, reason:"storage-error", message}` instead of letting
// the rejection propagate unhandled — this is what every calling form's
// existing `if (!result.queued) { setError(...); setSubmitting(false); }`
// branch now correctly reaches instead of the Save button sticking
// forever with the typed data lost.
//
// This proves the production module's own CONTRACT — the real
// enqueue*() functions, imported directly, not hand-copied. It does NOT
// exercise React component rendering or an actual browser's "the button
// visibly re-enables and shows this text" behavior: this repo has no
// jsdom/React-testing-library/browser-automation tooling at all, so
// that remains a manual/real-browser verification item, same as every
// other UI-behavior claim made throughout this whole audit engagement.
//
// Uses fake-indexeddb (new devDependency, test-only) so Dexie has a real
// IndexedDB implementation to run its actual transaction/abort logic
// against under Node — nothing here is mocked at the Dexie level, only
// individual Table methods are monkey-patched per-check to force the
// exact failure this fix is meant to catch, then restored immediately.
//
// Run via: npx tsx test-upgrade-offline-storage-error-handling.mjs
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
const { getOfflineDb, describeOfflineStorageError } = dbModule;
const { enqueueCreateCustomer, enqueueCreateOrder, enqueueSaveMeasurement, enqueueDeleteOrder } = syncEngine;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

function buildOrderFormData() {
  const fd = new FormData();
  fd.set("orderDate", new Date().toISOString().slice(0, 10));
  fd.set("totalAmount", "1000.00");
  fd.set("advanceAmount", "0.00");
  fd.set("kameezQuantity", "0");
  return fd;
}

try {
  const db = getOfflineDb();
  await db.open();

  // ══════════════════════════════════════════════════════════════════
  // 1. Baseline — a normal call against the fake IndexedDB still
  //    succeeds. Proves the harness works and nothing successful
  //    regressed.
  // ══════════════════════════════════════════════════════════════════
  console.log("1. Baseline: a healthy enqueueCreateCustomer call still succeeds");
  const baseline = await enqueueCreateCustomer({ name: "Baseline Customer", phonePrimary: "03001234567", phoneSecondary: "", address: "" });
  check("queued:true with an id", baseline.queued === true && typeof baseline.id === "string");

  // ══════════════════════════════════════════════════════════════════
  // 2. enqueueCreateCustomer: a rejecting transaction is caught, not thrown
  // ══════════════════════════════════════════════════════════════════
  console.log("2. enqueueCreateCustomer: a rejecting transaction is caught, not thrown");
  const originalCustomersAdd = db.customers.add.bind(db.customers);
  db.customers.add = () => {
    throw new Error("Simulated Dexie failure");
  };
  let threw2 = false;
  let result2;
  try {
    result2 = await enqueueCreateCustomer({ name: "Will Fail", phonePrimary: "03001112222", phoneSecondary: "", address: "" });
  } catch {
    threw2 = true;
  } finally {
    db.customers.add = originalCustomersAdd;
  }
  check("does not throw/reject past enqueueCreateCustomer", threw2 === false);
  check(
    "returns {queued:false, reason:\"storage-error\"} with a non-empty message",
    result2?.queued === false && result2?.reason === "storage-error" && typeof result2?.message === "string" && result2.message.length > 0
  );

  const recovered2 = await enqueueCreateCustomer({ name: "Recovered Customer", phonePrimary: "03003334444", phoneSecondary: "", address: "" });
  check("a later call succeeds again once the table method is restored (no lasting corruption)", recovered2.queued === true);

  // ══════════════════════════════════════════════════════════════════
  // 3. enqueueCreateOrder: same contract for OrderEnqueueResult
  // ══════════════════════════════════════════════════════════════════
  console.log("3. enqueueCreateOrder: same contract for a different result shape (OrderEnqueueResult)");
  const customerForOrder = await enqueueCreateCustomer({ name: "Order Customer", phonePrimary: "03005556666", phoneSecondary: "", address: "" });
  const originalOrdersAdd = db.orders.add.bind(db.orders);
  db.orders.add = () => {
    throw new Error("Simulated Dexie failure");
  };
  let threw3 = false;
  let result3;
  try {
    result3 = await enqueueCreateOrder(customerForOrder.id, buildOrderFormData());
  } catch {
    threw3 = true;
  } finally {
    db.orders.add = originalOrdersAdd;
  }
  check("does not throw/reject past enqueueCreateOrder", threw3 === false);
  check(
    "returns {queued:false, reason:\"storage-error\"} with a message",
    result3?.queued === false && result3?.reason === "storage-error" && typeof result3?.message === "string"
  );

  // ══════════════════════════════════════════════════════════════════
  // 4. enqueueSaveMeasurement: same contract, CustomerEnqueueResult again
  //    but via a different function (measurements table)
  // ══════════════════════════════════════════════════════════════════
  console.log("4. enqueueSaveMeasurement: same contract via the measurements table");
  const originalMeasurementsPut = db.measurements.put.bind(db.measurements);
  db.measurements.put = () => {
    throw new Error("Simulated Dexie failure");
  };
  let threw4 = false;
  let result4;
  try {
    result4 = await enqueueSaveMeasurement(customerForOrder.id, {
      length: "40",
      shoulder: "",
      sleeve: "",
      armHole: "",
      kohni: "",
      neck: "",
      chest: "",
      waist: "",
      hem: "",
      shalwarLength: "",
      pancha: "",
      shalwarGheraReady: "",
      shalwarPocket: "",
      note: "",
    });
  } catch {
    threw4 = true;
  } finally {
    db.measurements.put = originalMeasurementsPut;
  }
  check("does not throw/reject past enqueueSaveMeasurement", threw4 === false);
  check(
    "returns {queued:false, reason:\"storage-error\"} with a message",
    result4?.queued === false && result4?.reason === "storage-error" && typeof result4?.message === "string"
  );

  // ══════════════════════════════════════════════════════════════════
  // 5. enqueueDeleteOrder: OrderDeleteEnqueueResult — this was the one
  //    shape that didn't even have a `message` field before this fix.
  // ══════════════════════════════════════════════════════════════════
  console.log("5. enqueueDeleteOrder: OrderDeleteEnqueueResult now also carries a message on failure");
  const orderForDelete = await enqueueCreateOrder(customerForOrder.id, buildOrderFormData());
  const originalOrdersDelete = db.orders.delete.bind(db.orders);
  db.orders.delete = () => {
    throw new Error("Simulated Dexie failure");
  };
  let threw5 = false;
  let result5;
  try {
    result5 = await enqueueDeleteOrder(customerForOrder.id, orderForDelete.id);
  } catch {
    threw5 = true;
  } finally {
    db.orders.delete = originalOrdersDelete;
  }
  check("does not throw/reject past enqueueDeleteOrder", threw5 === false);
  check(
    "returns {queued:false, reason:\"storage-error\"} with a message",
    result5?.queued === false && result5?.reason === "storage-error" && typeof result5?.message === "string"
  );

  // ══════════════════════════════════════════════════════════════════
  // 6. describeOfflineStorageError: distinguishable, reassuring messages
  // ══════════════════════════════════════════════════════════════════
  console.log("6. describeOfflineStorageError: quota-exceeded vs. a generic/unknown failure");
  const quotaMessage = describeOfflineStorageError(new DOMException("quota", "QuotaExceededError"));
  const genericMessage = describeOfflineStorageError(new Error("some other failure"));
  check("quota-exceeded gets its own distinct message naming storage", quotaMessage.toLowerCase().includes("storage") && quotaMessage !== genericMessage);
  check("a generic/unknown error still gets a non-empty, user-safe message", typeof genericMessage === "string" && genericMessage.length > 0);
  check(
    "both messages reassure the user nothing was actually lost",
    quotaMessage.toLowerCase().includes("nothing was lost") && genericMessage.toLowerCase().includes("nothing was lost")
  );
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
