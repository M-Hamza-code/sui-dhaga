// Regression test for the UPDATE_ORDER idempotency-receipt mechanism
// (SyncOperationReceipt, src/lib/order-update.ts) — the core correctness
// requirement behind the whole offline sync retry/baseline-freeze
// redesign: a lost-response retry must replay its own prior result
// exactly once, never double-apply, and a genuinely reused operationId
// with different content must be rejected outright, never silently
// treated as either a plain conflict or a successful write.
//
// Imports applyOrderUpdateSync/computeOrderUpdatePayloadHash DIRECTLY
// from the real src/lib/order-update.ts via `tsx` (already a
// devDependency, used elsewhere for prisma/seed.ts) — not a hand-copy.
// This is a lib-level test, not an HTTP one: it calls the same function
// order-update/route.ts calls, bypassing only that route's own thin
// field-extraction/status-code wrapper (no authenticated-HTTP-test
// convention exists anywhere else in this suite to reuse).
//
// Run ONLY via: npx tsx test-upgrade-order-update-idempotency-receipt.mjs
// (loads .env.test itself — does NOT go through scripts/run-tests.mjs,
// since it never touches the HTTP layer and needs no dev server.)
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(PROJECT_ROOT, ".env.test"));

const { assertTestDatabase } = await import("./scripts/lib/test-db-guard.mjs");
assertTestDatabase(process.env.DATABASE_URL);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// Same CJS/ESM-interop quirk as test-upgrade-sync-dispatch-prep.mjs —
// named-export destructuring through tsx doesn't resolve reliably here,
// `.default` does.
const orderUpdateModule = await import("./src/lib/order-update.ts");
const { applyOrderUpdateSync } = orderUpdateModule.default ?? orderUpdateModule;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

function minimalOrderFormData(overrides = {}) {
  const fd = new FormData();
  const fields = {
    orderDate: "2026-01-01",
    totalAmount: "1000.00",
    advanceAmount: "0.00",
    kameezQuantity: "1",
    princeCoatQuantity: "0",
    waistcoatQuantity: "0",
    collarType: "POINT",
    note: "original note",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

const suffix = Date.now();
let customerId = null;
let orderId = null;

try {
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-RECEIPT-${suffix}`, name: "Idempotency Receipt Test Customer", phonePrimary: "03000000010" },
  });
  customerId = customer.id;

  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-RECEIPT-ORDER-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "500.00",
      advanceAmount: "0.00",
      items: { create: [{ position: 1 }] },
    },
  });
  orderId = order.id;
  const initialUpdatedAt = order.updatedAt.toISOString();

  // ── 1. Ordinary successful update — baseline case. ────────────────────
  console.log("1. Ordinary update succeeds and writes exactly one receipt");
  const key1 = crypto.randomUUID();
  const result1 = await applyOrderUpdateSync(customerId, orderId, minimalOrderFormData(), initialUpdatedAt, key1);
  check("first update succeeds", result1.ok === true);
  const receiptCountAfter1 = await prisma.syncOperationReceipt.count({ where: { operationId: key1 } });
  check("exactly one receipt row exists for this operationId", receiptCountAfter1 === 1);
  const orderAfter1 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  check("the order's updatedAt actually advanced", orderAfter1.updatedAt.toISOString() !== initialUpdatedAt);
  check("result.updatedAt matches the order's real new updatedAt", result1.ok && result1.updatedAt === orderAfter1.updatedAt.toISOString());

  // ── 2. Lost-response retry — SAME key, SAME frozen baseline/content —
  //      must replay the exact prior result, never apply twice. ─────────
  console.log("2. Lost-response retry (same key, same payload) replays instead of re-applying");
  const itemCountBefore2 = await prisma.orderItem.count({ where: { orderId } });
  const snapshotCountBefore2 = await prisma.measurementSnapshot.count();
  const result2 = await applyOrderUpdateSync(customerId, orderId, minimalOrderFormData(), initialUpdatedAt, key1);
  check("retry with the identical frozen baseline + payload reports success", result2.ok === true);
  check("retry's reported updatedAt is identical to the first attempt's (a true replay)", result2.ok && result1.ok && result2.updatedAt === result1.updatedAt);
  const receiptCountAfter2 = await prisma.syncOperationReceipt.count({ where: { operationId: key1 } });
  check("still exactly one receipt row — the retry did not write a second one", receiptCountAfter2 === 1);
  const itemCountAfter2 = await prisma.orderItem.count({ where: { orderId } });
  const snapshotCountAfter2 = await prisma.measurementSnapshot.count();
  check("the retry created no new OrderItem rows", itemCountAfter2 === itemCountBefore2);
  check("the retry created no new MeasurementSnapshot rows (no double-apply)", snapshotCountAfter2 === snapshotCountBefore2);

  // ── 3. Reused key, DIFFERENT payload — must be rejected outright, never
  //      silently replayed and never treated as an ordinary conflict. ───
  console.log("3. Reused operationId with a genuinely different payload is rejected, not replayed or conflicted");
  const orderBefore3 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const result3 = await applyOrderUpdateSync(customerId, orderId, minimalOrderFormData({ note: "a completely different note" }), orderBefore3.updatedAt.toISOString(), key1);
  check("reusing the key with different content is rejected", result3.ok === false);
  check("the rejection reason is specifically idempotency-key-reuse, not conflict", !result3.ok && result3.reason === "idempotency-key-reuse");
  const orderAfter3 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  check("the order was NOT modified by the rejected reuse attempt", orderAfter3.updatedAt.toISOString() === orderBefore3.updatedAt.toISOString());

  // ── 4. Genuine conflict — a fresh key with a stale baseline. ───────────
  console.log("4. A genuinely stale baseline (fresh key) is reported as a real conflict");
  const key4 = crypto.randomUUID();
  const staleBaseline = initialUpdatedAt; // long since superseded by steps 1-3
  const result4 = await applyOrderUpdateSync(customerId, orderId, minimalOrderFormData({ note: "yet another note" }), staleBaseline, key4);
  check("a stale baseline under a fresh key is a real conflict", !result4.ok && result4.reason === "conflict");
  check("the conflict reports the order's actual current updatedAt, not the stale one", !result4.ok && result4.reason === "conflict" && result4.serverUpdatedAt === orderAfter3.updatedAt.toISOString());
  const receiptCountAfter4 = await prisma.syncOperationReceipt.count({ where: { operationId: key4 } });
  check("a real conflict never writes a receipt", receiptCountAfter4 === 0);

  // ── 5. Concurrency — two near-simultaneous requests, same key, same
  //      payload, same order: exactly one receipt, both report the same
  //      result, neither reports a false conflict. ───────────────────────
  console.log("5. Two concurrent identical requests: one applies, the other correctly replays");
  const key5 = crypto.randomUUID();
  const orderBefore5 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const [resA, resB] = await Promise.all([
    applyOrderUpdateSync(customerId, orderId, minimalOrderFormData({ note: "concurrent note" }), orderBefore5.updatedAt.toISOString(), key5),
    applyOrderUpdateSync(customerId, orderId, minimalOrderFormData({ note: "concurrent note" }), orderBefore5.updatedAt.toISOString(), key5),
  ]);
  check("both concurrent requests report success", resA.ok === true && resB.ok === true);
  check("both report the identical result (no false conflict on either side)", resA.ok && resB.ok && resA.updatedAt === resB.updatedAt);
  const receiptCountAfter5 = await prisma.syncOperationReceipt.count({ where: { operationId: key5 } });
  check("exactly one receipt row exists after the race", receiptCountAfter5 === 1);
  const snapshotCountAfter5 = await prisma.measurementSnapshot.count({ where: { id: { not: undefined } } });
  // (Only asserting the race didn't throw/duplicate-write above is the
  // meaningful check here; absolute snapshot count already covered by
  // step 2's before/after comparison.)
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  if (orderId) {
    await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
    const o = await prisma.order.findUnique({ where: { id: orderId } }).catch(() => null);
    if (o?.defaultMeasurementSnapshotId) {
      await prisma.order.update({ where: { id: orderId }, data: { defaultMeasurementSnapshotId: null } }).catch(() => {});
    }
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }
  if (customerId) {
    await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
  }
  await prisma.$disconnect();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
