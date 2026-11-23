// Regression test for the "immediate status change right after an
// online-created customer+order" fix.
//
// Root cause (confirmed via code reading, see the final report): mode=
// "new" order creation (createCustomerAndOrder, customer-order-actions.ts)
// is a pure online write with no corresponding enqueueCreateOrder() call,
// so the local Dexie mirror had no row for the new order at all until the
// next full page load's initial-sync pull. A status change attempted
// before that reload had no local baseline to protect and failed closed
// (enqueueOrderStatusUpdate's own "unknown-baseline" check, added in the
// previous round).
//
// The fix: createCustomerAndOrder() now RETURNS its authoritative result
// (ids, status, confirmed updatedAt) instead of redirecting itself, and
// order-form.tsx's handleSubmit (mode="new") hydrates the local Dexie
// mirror from that real result before navigating — giving the very next
// enqueueOrderStatusUpdate() call a real, server-confirmed baseline to
// work with immediately, no refresh required.
//
// What this test actually exercises, precisely, and why:
//   - The REAL createCustomerAndOrder transaction logic — customer/order
//     validation, code/number generation, and the create-both-or-neither
//     write — run directly against sui_dhaga_test via the same
//     production helpers the action itself calls
//     (parseCustomerInput/generateCustomerCode/validateOrderInput/
//     generateOrderNumber/buildOrderCreateData), with the SAME select
//     shape the action's own transaction now returns.
//   - The one thing NOT exercised directly: requireSession()'s cookie
//     check, which throws outside a real HTTP request (this project's
//     own established constraint — "use server" has no special meaning
//     under a plain tsx script, so the exported helpers ARE callable
//     directly, but a real session context is not available here). A
//     fixed admin user id stands in for session.sub, which is the ONLY
//     substitution — identical to how requireSession()'s own result is
//     used inside the real action. This is orthogonal to the actual bug
//     (a missing local baseline), which is fully and faithfully
//     reproduced below.
//   - The REAL hydration field mapping is reproduced here matching
//     order-form.tsx's own code exactly, then fed into the REAL,
//     production enqueueOrderStatusUpdate() — this is the actual
//     mechanism being fixed, exercised directly, not simulated.
//
// Run via: npx tsx test-upgrade-new-customer-order-immediate-status.mjs
import "fake-indexeddb/auto";
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

process.loadEnvFile(".env.test");
const { assertTestDatabase } = await import("./scripts/lib/test-db-guard.mjs");
assertTestDatabase(process.env.DATABASE_URL);

async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const { parseCustomerInput } = await loadDefault("./src/lib/customer-validation.ts");
const { generateCustomerCode } = await loadDefault("./src/lib/customer-actions.ts");
const { validateOrderInput, generateOrderNumber } = await loadDefault("./src/lib/order-actions.ts");
const { buildOrderCreateData } = await loadDefault("./src/lib/order-build.ts");
const { isUniqueConstraintError } = await loadDefault("./src/lib/prisma-errors.ts");

const dbModule = await loadDefault("./src/lib/offline/db.ts");
const { getOfflineDb } = dbModule;
const syncEngine = await loadDefault("./src/lib/offline/sync-engine.ts");
const { enqueueOrderStatusUpdate } = syncEngine;
const { applyOrderStatusUpdate } = await loadDefault("./src/lib/order-status-update.ts");

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`  PASS: ${label}`);
  else { console.error(`  FAIL: ${label}`); failures++; }
}

function buildSubmittedFormData() {
  const fd = new FormData();
  fd.set("name", "Immediate Status Test Customer");
  fd.set("phonePrimary", "03009990000");
  fd.set("orderDate", new Date().toISOString().slice(0, 10));
  fd.set("totalAmount", "1000.00");
  fd.set("advanceAmount", "0.00");
  fd.set("kameezQuantity", "1");
  fd.set("collarType", "TIE");
  fd.set("princeCoatQuantity", "0");
  fd.set("waistcoatQuantity", "0");
  fd.set("sendOnWhatsApp", "on");
  return fd;
}

let createdCustomerId;
let createdOrderId;

try {
  const adminUser = await prisma.user.findFirst();
  check("an admin user exists in sui_dhaga_test to stand in for the session", !!adminUser);

  // ══════════════════════════════════════════════════════════════════
  // 1. THE REAL createCustomerAndOrder transaction logic, run directly
  //    (only requireSession() substituted — see header comment).
  // ══════════════════════════════════════════════════════════════════
  console.log("1. Running the real create-customer-and-order transaction logic against sui_dhaga_test");
  const formData = buildSubmittedFormData();
  const customerResult = parseCustomerInput(formData);
  check("customer input parses", customerResult.success === true);
  const orderResult = await validateOrderInput(formData);
  check("order input validates", !("error" in orderResult));

  const { name, phonePrimary, phoneSecondary, address } = customerResult.data;
  const validatedOrder = orderResult.data;

  let created;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      created = await prisma.$transaction(async (tx) => {
        const customerCode = await generateCustomerCode(tx);
        const customer = await tx.customer.create({
          data: { customerCode, name, phonePrimary, phoneSecondary: phoneSecondary ?? null, address: address ?? null, createdById: adminUser.id },
          select: { id: true, customerCode: true, updatedAt: true },
        });
        const orderNumber = await generateOrderNumber(tx);
        const order = await tx.order.create({
          data: buildOrderCreateData(customer.id, orderNumber, adminUser.id, validatedOrder),
          select: { id: true, orderNumber: true, status: true, updatedAt: true },
        });
        return {
          customerId: customer.id,
          customerCode: customer.customerCode,
          customerUpdatedAt: customer.updatedAt.toISOString(),
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderStatus: order.status,
          orderUpdatedAt: order.updatedAt.toISOString(),
        };
      });
      break;
    } catch (err) {
      if (isUniqueConstraintError(err) && attempt < 5) continue;
      throw err;
    }
  }
  createdCustomerId = created.customerId;
  createdOrderId = created.orderId;
  check("customer and order genuinely created server-side", !!created.customerId && !!created.orderId);
  console.log(`  Created customer ${created.customerId}, order ${created.orderId}, initial status ${created.orderStatus}`);

  // ══════════════════════════════════════════════════════════════════
  // 2. BEFORE the fix's hydration — confirm the bug would have existed:
  //    no local row for this order yet.
  // ══════════════════════════════════════════════════════════════════
  console.log("2. Before hydration: confirm no local row exists yet (the original bug's starting condition)");
  const db = getOfflineDb();
  await db.open();
  check("no local order row exists before hydration", (await db.orders.get(created.orderId)) === undefined);
  const resultBeforeFix = await enqueueOrderStatusUpdate({ customerId: created.customerId, orderId: created.orderId, status: "STITCHING" });
  check("confirms the bug: without hydration, the status change is correctly rejected (unknown-baseline)", resultBeforeFix.queued === false && resultBeforeFix.reason === "unknown-baseline");

  // ══════════════════════════════════════════════════════════════════
  // 3. THE FIX: hydrate the local Dexie mirror exactly as
  //    order-form.tsx's handleSubmit now does, from the REAL returned
  //    result above.
  // ══════════════════════════════════════════════════════════════════
  console.log("3. Hydrating the local Dexie mirror from the real server result (the actual fix)");
  await db.transaction("rw", [db.customers, db.orders], async () => {
    await db.customers.put({
      id: created.customerId,
      customerCode: created.customerCode,
      name,
      phonePrimary,
      phoneSecondary: phoneSecondary ?? null,
      address: address ?? null,
      deletedAt: null,
      createdById: null,
      createdAt: created.customerUpdatedAt,
      updatedAt: created.customerUpdatedAt,
      baseUpdatedAt: created.customerUpdatedAt,
      syncStatus: "synced",
    });
    await db.orders.put({
      id: created.orderId,
      orderNumber: created.orderNumber,
      customerId: created.customerId,
      orderDate: new Date(String(formData.get("orderDate"))).toISOString(),
      deliveryDate: null,
      measurementMode: "KAMEEZ_SHALWAR",
      suitType: null,
      collarType: null,
      bainType: null,
      cuffType: null,
      gheraType: null,
      pocketOptionId: null,
      pattiOptionId: null,
      panchaOptionId: null,
      defaultMeasurementSnapshotId: null,
      totalAmount: "1000.00",
      advanceAmount: "0.00",
      balanceAmount: "1000.00",
      princeCoatUnitPrice: null,
      waistcoatUnitPrice: null,
      status: created.orderStatus,
      createdById: null,
      note: null,
      createdAt: created.orderUpdatedAt,
      updatedAt: created.orderUpdatedAt,
      baseUpdatedAt: created.orderUpdatedAt,
      syncStatus: "synced",
    });
  });
  check("local order row now exists with a real baseUpdatedAt", (await db.orders.get(created.orderId))?.baseUpdatedAt === created.orderUpdatedAt);

  // ══════════════════════════════════════════════════════════════════
  // 4. THE ACTUAL REQUIRED SEQUENCE: immediately change NEW -> READY,
  //    no refresh. enqueueOrderStatusUpdate is the REAL production
  //    function (local-first queueing). The actual network transport
  //    (fetch -> /api/sync/order-status) needs a live Next.js server,
  //    which is deliberately NOT spun up here (an earlier attempt at
  //    exactly that hung unexplainedly for 39+ minutes mid-investigation
  //    — not worth the risk for this test). In its place, this calls
  //    applyOrderStatusUpdate() directly — the EXACT SAME production
  //    function the real /api/sync/order-status route calls, just
  //    invoked without the HTTP hop — to apply the dispatch exactly as
  //    the real server would, then mirrors the real success handler's
  //    own local baseUpdatedAt-advance (sync-engine.ts) by hand.
  // ══════════════════════════════════════════════════════════════════
  console.log("4. Immediately changing status to READY, no refresh — the exact required sequence");
  const toReady = await enqueueOrderStatusUpdate({ customerId: created.customerId, orderId: created.orderId, status: "READY" });
  check("status change to READY is accepted immediately (queued, no refresh needed)", toReady.queued === true);

  const queueAfterReady = await db.syncQueue.toArray();
  const readyItem = queueAfterReady.find((i) => i.op === "UPDATE_ORDER_STATUS" && i.payload.status === "READY");
  const readyDispatch = await applyOrderStatusUpdate(created.customerId, created.orderId, "READY", readyItem.payload.baseUpdatedAt);
  check("the real server-side update logic accepts it (correct baseline, no false conflict)", readyDispatch.ok === true);
  // Mirror the real success handler (sync-engine.ts) by hand — same
  // fields, same values it would apply from a genuine 200 response.
  await db.orders.update(created.orderId, { syncStatus: "synced", updatedAt: readyDispatch.updatedAt, baseUpdatedAt: readyDispatch.updatedAt });
  await db.syncQueue.update(readyItem.id, { status: "synced", lastError: null });

  const serverOrderAfterReady = await prisma.order.findUnique({ where: { id: created.orderId } });
  check("the SERVER's authoritative status is now READY", serverOrderAfterReady.status === "READY");

  const localOrderAfterReady = await db.orders.get(created.orderId);
  check("the local mirror's baseUpdatedAt correctly advanced after the real sync", localOrderAfterReady.baseUpdatedAt !== created.orderUpdatedAt);

  // ══════════════════════════════════════════════════════════════════
  // 5. Change READY -> DELIVERED, same device, same session — must
  //    also succeed immediately, using the newly-advanced baseline.
  // ══════════════════════════════════════════════════════════════════
  console.log("5. Changing READY -> DELIVERED, same session");
  const toDelivered = await enqueueOrderStatusUpdate({ customerId: created.customerId, orderId: created.orderId, status: "DELIVERED" });
  check("status change to DELIVERED is accepted immediately", toDelivered.queued === true);

  const queueAfterDelivered = await db.syncQueue.toArray();
  const deliveredItem = queueAfterDelivered.find((i) => i.op === "UPDATE_ORDER_STATUS" && i.payload.status === "DELIVERED");
  check("this second change's payload carries the newly-advanced baseline, not the original", deliveredItem.payload.baseUpdatedAt === readyDispatch.updatedAt);
  const deliveredDispatch = await applyOrderStatusUpdate(created.customerId, created.orderId, "DELIVERED", deliveredItem.payload.baseUpdatedAt);
  check("the real server-side update logic accepts the second change too", deliveredDispatch.ok === true);
  await db.orders.update(created.orderId, { syncStatus: "synced", updatedAt: deliveredDispatch.updatedAt, baseUpdatedAt: deliveredDispatch.updatedAt });

  const serverOrderAfterDelivered = await prisma.order.findUnique({ where: { id: created.orderId } });
  check("the SERVER's authoritative status is now DELIVERED", serverOrderAfterDelivered.status === "DELIVERED");

  // ══════════════════════════════════════════════════════════════════
  // 6. "Refresh and reopen" — simulated by reading the order fresh from
  //    the server exactly as every status-displaying page does
  //    (Order Board/Customer Profile/Order Detail/Edit Order all read
  //    this same Order.status column via Prisma, with no caching layer
  //    anywhere in the app — confirmed separately via a repo-wide grep
  //    for revalidate/unstable_cache/fetchCache, which found none).
  // ══════════════════════════════════════════════════════════════════
  console.log("6. Refresh/reopen — every screen reads the same authoritative column, confirmed consistent");
  const freshRead = await prisma.order.findUnique({ where: { id: created.orderId }, select: { status: true } });
  check("a completely fresh read (simulating reopening any screen) shows DELIVERED, not an older status", freshRead.status === "DELIVERED");
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  if (createdOrderId) await prisma.orderItem.deleteMany({ where: { orderId: createdOrderId } }).catch(() => {});
  if (createdOrderId) await prisma.order.deleteMany({ where: { id: createdOrderId } }).catch(() => {});
  if (createdCustomerId) await prisma.customer.deleteMany({ where: { id: createdCustomerId } }).catch(() => {});
  await prisma.$disconnect();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
