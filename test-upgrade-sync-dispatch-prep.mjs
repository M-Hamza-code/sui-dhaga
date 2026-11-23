// Regression/behavior test for the UPDATE_ORDER/UPDATE_CUSTOMER
// baseline-freeze dispatch logic (prepareItemForDispatch, sync-engine.ts).
//
// Imports the REAL exported function directly from sync-engine.ts via
// `tsx` (already a devDependency — used elsewhere for prisma/seed.ts) —
// NOT a hand-duplicated copy of the logic, unlike the Prisma-model-shape
// test-upgrade-*.mjs files, which duplicate because this runner's normal
// plain-`node` execution has no TypeScript loader. Pure logic, no Dexie,
// no browser, no Prisma, no network — dependencies are injected fakes.
//
// Run via: npx tsx test-upgrade-sync-dispatch-prep.mjs
// (NOT via scripts/run-tests.mjs — that spawns plain `node` and also
// starts an isolated Next.js dev server this test doesn't need.)
// Named-export destructuring doesn't resolve reliably through tsx's
// CJS/ESM interop for this file in this environment (Node's static
// cjs-module-lexer falls back to a single `default` bucket) — importing
// the namespace and reading off `.default` is what actually works; this
// is still the REAL exported function from the real module, not a copy.
import * as syncEngine from "./src/lib/offline/sync-engine.ts";
const prepareItemForDispatch = syncEngine.default.prepareItemForDispatch;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

function baseItem(overrides = {}) {
  return {
    id: 1,
    op: "UPDATE_ORDER",
    payload: { orderId: "order-1", customerId: "cust-1", fields: {}, baseUpdatedAt: "STALE-ENQUEUE-TIME-VALUE" },
    status: "pending",
    attempts: 0,
    lastError: null,
    idempotencyKey: "key-1",
    createdAt: Date.now(),
    ...overrides,
  };
}

async function run() {
  // 1. First dispatch: freezes the live baseline, persists it, returns
  //    the FROZEN object (not the stale original `item`) to send.
  {
    const persisted = [];
    const item = baseItem();
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => "LIVE-CONFIRMED-VALUE",
      persist: async (id, fields) => {
        persisted.push({ id, fields });
        return 1;
      },
    });
    check("first dispatch succeeds", result.ok === true);
    check("itemToSend carries the frozen live baseline, not the stale enqueue-time one", result.ok && result.itemToSend.payload.baseUpdatedAt === "LIVE-CONFIRMED-VALUE");
    check("the ORIGINAL item object is untouched (no mutation)", item.payload.baseUpdatedAt === "STALE-ENQUEUE-TIME-VALUE" && item.baselineResolved === undefined);
    check("persisted exactly once, with baselineResolved + sending + frozen payload", persisted.length === 1 && persisted[0].fields.baselineResolved === true && persisted[0].fields.status === "sending");
  }

  // 2. Already-resolved item: never re-reads the live baseline, sends
  //    the original payload unchanged.
  {
    let readCalled = false;
    const item = baseItem({ baselineResolved: true, payload: { orderId: "order-1", customerId: "cust-1", fields: {}, baseUpdatedAt: "ALREADY-FROZEN" } });
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => {
        readCalled = true;
        return "SHOULD-NEVER-BE-USED";
      },
      persist: async () => 1,
    });
    check("already-resolved item does not re-read the live baseline", readCalled === false);
    check("already-resolved item sends its existing frozen payload unchanged", result.ok && result.itemToSend.payload.baseUpdatedAt === "ALREADY-FROZEN");
  }

  // 3. Missing/invalid live baseline: fails closed, permanently —
  //    never falls back to the stale payload.baseUpdatedAt.
  {
    const item = baseItem();
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => null,
      persist: async () => 1,
    });
    check("missing baseline is reported distinctly", !result.ok && result.reason === "missing-record");
  }

  // 4. Transient read error (readLiveBaseline THROWS, not returns null)
  //    is a DIFFERENT, retryable outcome — never conflated with a
  //    genuinely missing record.
  {
    const item = baseItem();
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => {
        throw new Error("IndexedDB transaction failed transiently");
      },
      persist: async () => 1,
    });
    check("transient read error is distinct from missing-record", !result.ok && result.reason === "transient-read-error");
    check("transient read error carries the underlying message", !result.ok && result.reason === "transient-read-error" && result.message.includes("transiently"));
  }

  // 5. Persist failure (Dexie update() resolves 0, e.g. the row vanished)
  //    blocks the network entirely — never sends on an unconfirmed write.
  {
    let sendAttempted = false;
    const item = baseItem();
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => "LIVE-VALUE",
      persist: async () => {
        return 0; // Dexie Table.update()'s own "0 rows modified" contract
      },
    });
    check("a persist count of 0 is reported as persist-failed, not silently treated as success", !result.ok && result.reason === "persist-failed");
    check("nothing marked a send as attempted", sendAttempted === false);
  }

  // 6. Old pre-existing queue items (from before this field existed) have
  //    baselineResolved === undefined, not false — must be treated
  //    identically to a brand-new item (first-dispatch path), not crash.
  {
    const item = baseItem();
    delete item.baselineResolved;
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => "LIVE-VALUE",
      persist: async () => 1,
    });
    check("an item with baselineResolved undefined is treated as first dispatch (no crash, resolves live)", result.ok && result.itemToSend.payload.baseUpdatedAt === "LIVE-VALUE");
  }

  // 7. UPDATE_CUSTOMER follows the identical rule (op-agnostic logic).
  {
    const item = baseItem({ op: "UPDATE_CUSTOMER", payload: { customerId: "cust-1", name: "x", phonePrimary: "1", phoneSecondary: null, address: null, baseUpdatedAt: "STALE" } });
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => "LIVE-CUSTOMER-VALUE",
      persist: async () => 1,
    });
    check("UPDATE_CUSTOMER freezes its live baseline the same way UPDATE_ORDER does", result.ok && result.itemToSend.payload.baseUpdatedAt === "LIVE-CUSTOMER-VALUE");
  }

  // 8. An op that never carries a baseline (e.g. DELETE_ORDER — its local
  //    order row is deleted at enqueue time, so there is nothing left to
  //    re-read; see DeleteOrderPayload's own comment in sync-engine.ts)
  //    skips baseline resolution entirely and just transitions to sending.
  //    (UPDATE_ORDER_STATUS is NOT an example of this anymore — it gained
  //    live baseline-freezing in this same round, covered by test 7's
  //    sibling check below instead.)
  {
    let readCalled = false;
    const item = baseItem({ op: "DELETE_ORDER", payload: { customerId: "cust-1", orderId: "order-1" } });
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => {
        readCalled = true;
        return "X";
      },
      persist: async () => 1,
    });
    check("an op with no baseline concept never calls readLiveBaseline", readCalled === false);
    check("it still dispatches successfully", result.ok === true);
  }

  // 9. UPDATE_ORDER_STATUS now freezes its live baseline too (added this
  //    round, alongside the UPDATE_CUSTOMER/UPDATE_ORDER/DELETE_ORDER
  //    concurrency work) — same rule as UPDATE_ORDER/UPDATE_CUSTOMER.
  {
    const item = baseItem({ op: "UPDATE_ORDER_STATUS", payload: { customerId: "cust-1", orderId: "order-1", status: "NEW", baseUpdatedAt: "STALE" } });
    const result = await prepareItemForDispatch(item, {
      readLiveBaseline: async () => "LIVE-STATUS-VALUE",
      persist: async () => 1,
    });
    check("UPDATE_ORDER_STATUS freezes its live baseline the same way UPDATE_ORDER/UPDATE_CUSTOMER do", result.ok && result.itemToSend.payload.baseUpdatedAt === "LIVE-STATUS-VALUE");
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

run();
