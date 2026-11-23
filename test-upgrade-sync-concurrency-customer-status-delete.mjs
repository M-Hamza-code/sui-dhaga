// Regression test for the atomic concurrency guards added to
// UPDATE_CUSTOMER (src/lib/customer-sync.ts), UPDATE_ORDER_STATUS
// (src/lib/order-status-update.ts), and DELETE_ORDER
// (src/lib/order-delete-sync.ts) — the remaining offline-sync
// concurrency work after the UPDATE_ORDER idempotency-receipt pass.
//
// Imports applyCustomerUpdateSync/applyOrderStatusUpdate/
// applyOrderDeleteSync DIRECTLY from the real src/lib/*.ts files via
// `tsx` (already a devDependency), against the real sui_dhaga_test
// database — not hand-copies, same approach as
// test-upgrade-order-update-idempotency-receipt.mjs.
//
// Run ONLY via: npx tsx test-upgrade-sync-concurrency-customer-status-delete.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(PROJECT_ROOT, ".env.test"));

const { assertTestDatabase } = await import("./scripts/lib/test-db-guard.mjs");
assertTestDatabase(process.env.DATABASE_URL);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// Same CJS/ESM-interop quirk as the other tsx-run tests in this suite —
// named-export destructuring doesn't resolve reliably here, `.default` does.
const customerSyncModule = await import("./src/lib/customer-sync.ts");
const { applyCustomerUpdateSync } = customerSyncModule.default ?? customerSyncModule;
const orderStatusModule = await import("./src/lib/order-status-update.ts");
const { applyOrderStatusUpdate } = orderStatusModule.default ?? orderStatusModule;
const orderDeleteSyncModule = await import("./src/lib/order-delete-sync.ts");
const { applyOrderDeleteSync } = orderDeleteSyncModule.default ?? orderDeleteSyncModule;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const suffix = Date.now();
let customerId = null;
const orderIds = [];

try {
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-CONC-${suffix}`, name: "Concurrency Test Customer", phonePrimary: "03000000020" },
  });
  customerId = customer.id;

  // ══════════════════════════════════════════════════════════════════
  // 1. UPDATE_CUSTOMER — atomic conditional update
  // ══════════════════════════════════════════════════════════════════
  console.log("1a. Stale baseline + genuinely different content -> real conflict");
  const baseline1 = customer.updatedAt.toISOString();
  const r1a = await applyCustomerUpdateSync({
    customerId,
    name: "First Legit Edit",
    phonePrimary: "03000000020",
    phoneSecondary: null,
    address: null,
    baseUpdatedAt: baseline1,
  });
  check("first edit succeeds", r1a.ok === true);
  const custAfter1a = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

  const r1b = await applyCustomerUpdateSync({
    customerId,
    name: "Second Edit, Stale Baseline, Different Content",
    phonePrimary: "03000000020",
    phoneSecondary: null,
    address: null,
    baseUpdatedAt: baseline1, // deliberately stale — same as before the first edit
  });
  check("stale baseline + different content is a real conflict", !r1b.ok && r1b.reason === "conflict");
  check("the conflict reports the ACTUAL current updatedAt", !r1b.ok && r1b.reason === "conflict" && r1b.serverUpdatedAt === custAfter1a.updatedAt.toISOString());

  console.log("1b. Stale baseline + IDENTICAL content already applied -> idempotent success, not a conflict");
  const r1c = await applyCustomerUpdateSync({
    customerId,
    name: "First Legit Edit", // identical to what's already stored
    phonePrimary: "03000000020",
    phoneSecondary: null,
    address: null,
    baseUpdatedAt: baseline1, // still stale
  });
  check("identical content under a stale baseline is idempotent success", r1c.ok === true);

  console.log("1c. Two concurrent identical updates — one applies, the other replays idempotently");
  const custBefore1d = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const [r1d, r1e] = await Promise.all([
    applyCustomerUpdateSync({
      customerId,
      name: "Concurrent Edit",
      phonePrimary: "03000000021",
      phoneSecondary: null,
      address: null,
      baseUpdatedAt: custBefore1d.updatedAt.toISOString(),
    }),
    applyCustomerUpdateSync({
      customerId,
      name: "Concurrent Edit",
      phonePrimary: "03000000021",
      phoneSecondary: null,
      address: null,
      baseUpdatedAt: custBefore1d.updatedAt.toISOString(),
    }),
  ]);
  check("both concurrent identical requests report success", r1d.ok === true && r1e.ok === true);
  check("neither concurrent request reports a false conflict", r1d.ok && r1e.ok);

  // ══════════════════════════════════════════════════════════════════
  // 2. UPDATE_ORDER_STATUS — atomic conditional update
  // ══════════════════════════════════════════════════════════════════
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-CONC-ORDER-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "500.00",
      advanceAmount: "0.00",
      status: "NEW",
    },
  });
  orderIds.push(order.id);

  console.log("2a. Online-path call (no baseUpdatedAt) keeps its original unconditional behavior");
  const rOnline = await applyOrderStatusUpdate(customerId, order.id, "STITCHING");
  check("online-path call (undefined baseUpdatedAt) still succeeds unconditionally", rOnline.ok === true && rOnline.changed === true);

  console.log("2b. Stale baseline + a genuinely different target status -> real conflict");
  const orderAfter2a = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const staleBaseline2 = order.updatedAt.toISOString(); // from before step 2a
  const r2b = await applyOrderStatusUpdate(customerId, order.id, "READY", staleBaseline2);
  check("stale baseline + different status is a real conflict", !r2b.ok && r2b.reason === "conflict");
  check("conflict reports the actual current updatedAt", !r2b.ok && r2b.reason === "conflict" && r2b.serverUpdatedAt === orderAfter2a.updatedAt.toISOString());

  console.log("2c. Requesting the status the order ALREADY has -> idempotent success regardless of baseline");
  const r2c = await applyOrderStatusUpdate(customerId, order.id, "STITCHING", staleBaseline2); // still stale, but STITCHING is already current
  check("same-status request under a stale baseline is idempotent, not a conflict", r2c.ok === true && r2c.changed === false);

  console.log("2d. Two concurrent identical status-change requests — one applies, the other replays idempotently");
  const orderBefore2d = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const [r2d, r2e] = await Promise.all([
    applyOrderStatusUpdate(customerId, order.id, "READY", orderBefore2d.updatedAt.toISOString()),
    applyOrderStatusUpdate(customerId, order.id, "READY", orderBefore2d.updatedAt.toISOString()),
  ]);
  check("both concurrent identical status requests report success", r2d.ok === true && r2e.ok === true);

  // ══════════════════════════════════════════════════════════════════
  // 3. DELETE_ORDER — atomic conditional touch-update + row lock
  // ══════════════════════════════════════════════════════════════════
  const orderToDelete1 = await prisma.order.create({
    data: {
      orderNumber: `TEST-CONC-DEL-A-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "200.00",
      advanceAmount: "0.00",
      items: { create: [{ position: 1 }] },
    },
  });
  orderIds.push(orderToDelete1.id);

  console.log("3a. Stale baseline (order genuinely changed since) -> real conflict, nothing deleted");
  const staleBaseline3 = orderToDelete1.updatedAt.toISOString();
  await prisma.order.update({ where: { id: orderToDelete1.id }, data: { note: "changed after the device's own last view" } });
  const r3a = await applyOrderDeleteSync(customerId, orderToDelete1.id, staleBaseline3);
  check("stale baseline on delete is a real conflict", !r3a.ok && r3a.reason === "conflict");
  const stillExists3a = await prisma.order.findUnique({ where: { id: orderToDelete1.id } });
  check("the order was NOT deleted by the rejected stale-baseline attempt", stillExists3a !== null);

  console.log("3b. Fresh baseline actually deletes the order (and its items/snapshot)");
  const currentOrder3b = await prisma.order.findUniqueOrThrow({ where: { id: orderToDelete1.id } });
  const r3b = await applyOrderDeleteSync(customerId, orderToDelete1.id, currentOrder3b.updatedAt.toISOString());
  check("delete with a correct baseline succeeds", r3b.ok === true && r3b.alreadyDeleted === false);
  const gone3b = await prisma.order.findUnique({ where: { id: orderToDelete1.id } });
  check("the order is actually gone", gone3b === null);
  const items3b = await prisma.orderItem.count({ where: { orderId: orderToDelete1.id } });
  check("its items are gone too", items3b === 0);

  console.log("3c. Retrying the same delete afterward -> idempotent already-deleted success, not an error");
  const r3c = await applyOrderDeleteSync(customerId, orderToDelete1.id, currentOrder3b.updatedAt.toISOString());
  check("retrying a delete for an already-gone order is a safe idempotent success", r3c.ok === true && r3c.alreadyDeleted === true);

  console.log("3d. Two concurrent identical deletes of the SAME order — one deletes, the other sees already-deleted, neither reports a false conflict");
  const orderToDelete2 = await prisma.order.create({
    data: {
      orderNumber: `TEST-CONC-DEL-B-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "300.00",
      advanceAmount: "0.00",
      items: { create: [{ position: 1 }] },
    },
  });
  orderIds.push(orderToDelete2.id);
  const baselineForRace = orderToDelete2.updatedAt.toISOString();
  const [r3d, r3e] = await Promise.all([
    applyOrderDeleteSync(customerId, orderToDelete2.id, baselineForRace),
    applyOrderDeleteSync(customerId, orderToDelete2.id, baselineForRace),
  ]);
  check("both concurrent identical deletes report success (not a false conflict)", r3d.ok === true && r3e.ok === true);
  check("exactly one of them actually performed the delete, the other found it already gone", [r3d, r3e].filter((r) => r.ok && r.alreadyDeleted === false).length === 1 && [r3d, r3e].filter((r) => r.ok && r.alreadyDeleted === true).length === 1);
  const goneRace = await prisma.order.findUnique({ where: { id: orderToDelete2.id } });
  check("the order is actually gone after the race", goneRace === null);
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  for (const orderId of orderIds) {
    await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
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
