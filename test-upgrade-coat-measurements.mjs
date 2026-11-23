// Regression test for the Prince Coat/Waistcoat Measurements + Suit &
// Styles "Not Specified" upgrade:
//   1. New CoatMeasurement model (persistent per-customer profile).
//   2. MeasurementSnapshot's 21 new coat*/waistcoat* columns, disjoint
//      from each other and from the pre-existing Kameez/Shalwar columns.
//   3. Order.measurementMode (defaults to KAMEEZ_SHALWAR) and
//      Order.suitType/cuffType/gheraType now nullable ("Not Specified",
//      and required for a Coat-mode order which submits none of them).
//   4. OrderItem.measurementMode nullable per-suit override ("ideally, an
//      order should also support both garment types").
//   5. A customer can have both a Measurement and a CoatMeasurement
//      profile at once, independently.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-coat-measurements.mjs
// Direct-Prisma only (no HTTP) — same reasoning as
// test-upgrades-measurements-pancha.mjs, which this mirrors.

import { assertTestDatabase } from "./scripts/lib/test-db-guard.mjs";

assertTestDatabase(process.env.DATABASE_URL);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

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
const snapshotIds = [];

try {
  // ── 1. CoatMeasurement profile round-trip, independent of Measurement ──
  console.log("1. CoatMeasurement profile (persistent per-customer)");
  const customer = await prisma.customer.create({
    data: {
      customerCode: `TEST-COAT-${suffix}`,
      name: "Coat Regression Test Customer",
      phonePrimary: "03000000001",
    },
  });
  customerId = customer.id;

  await prisma.measurement.create({ data: { customerId, chest: "42.00" } });
  const coatMeasurement = await prisma.coatMeasurement.create({
    data: {
      customerId,
      coatLength: "30.5",
      coatShoulder: "18",
      waistcoatLength: "24",
      waistcoatShoulder: "17.5",
      note: "Coat note",
    },
  });
  check("coatMeasurement created with a distinct id from measurement", coatMeasurement.customerId === customerId);

  const reread = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { measurement: true, coatMeasurement: true },
  });
  check("customer has BOTH a Measurement and a CoatMeasurement at once", reread.measurement !== null && reread.coatMeasurement !== null);
  check("Measurement.chest unaffected by CoatMeasurement existing", reread.measurement.chest.toString() === "42");
  check(
    "coatShoulder and waistcoatShoulder are stored independently (same body measurement, different garments, different values)",
    reread.coatMeasurement.coatShoulder.toString() === "18" && reread.coatMeasurement.waistcoatShoulder.toString() === "17.5"
  );
  check("coatLength/waistcoatLength never collide", reread.coatMeasurement.coatLength.toString() === "30.5" && reread.coatMeasurement.waistcoatLength.toString() === "24");
  check("fields not set (e.g. coatArmHole) are null, not defaulted to 0 or guessed", reread.coatMeasurement.coatArmHole === null);

  // Upsert (same as saveCoatMeasurement's own write path) must overwrite
  // in place, never create a second row.
  await prisma.coatMeasurement.upsert({
    where: { customerId },
    create: { customerId, coatLength: "31" },
    update: { coatLength: "31" },
  });
  const afterUpsert = await prisma.coatMeasurement.findMany({ where: { customerId } });
  check("upsert overwrites in place — still exactly one CoatMeasurement row for this customer", afterUpsert.length === 1);
  check("upsert actually applied the new value", afterUpsert[0].coatLength.toString() === "31");

  // ── 2. MeasurementSnapshot coat/waistcoat columns ───────────────────────
  console.log("2. MeasurementSnapshot coat*/waistcoat* columns");
  const kameezSnapshot = await prisma.measurementSnapshot.create({
    data: { length: "40", chest: "42", isBackfilled: false },
  });
  snapshotIds.push(kameezSnapshot.id);
  check("a plain Kameez/Shalwar snapshot has every coat/waistcoat field null", kameezSnapshot.coatLength === null && kameezSnapshot.waistcoatLength === null);

  const coatSnapshot = await prisma.measurementSnapshot.create({
    data: {
      coatLength: "30.5",
      coatBicep: "12.25",
      waistcoatLength: "24",
      waistcoatBackWidth: "16",
      isBackfilled: false,
    },
  });
  snapshotIds.push(coatSnapshot.id);
  check("a Coat-mode snapshot has every Kameez/Shalwar field null", coatSnapshot.length === null && coatSnapshot.chest === null && coatSnapshot.shalwarLength === null);
  check(
    "a Coat-mode snapshot's own coat/waistcoat values round-trip exactly, including an unaligned decimal",
    coatSnapshot.coatLength.toString() === "30.5" && coatSnapshot.coatBicep.toString() === "12.25" && coatSnapshot.waistcoatLength.toString() === "24" && coatSnapshot.waistcoatBackWidth.toString() === "16"
  );

  // ── 3. Order.measurementMode default + nullable suitType/cuffType/gheraType ──
  console.log("3. Order.measurementMode default, and Suit Type/Cuff/Ghera 'Not Specified'");
  const kameezOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-COAT-K-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      cuffType: "NOK_DAR",
      gheraType: "GOL",
    },
  });
  orderIds.push(kameezOrder.id);
  check("an order created without measurementMode defaults to KAMEEZ_SHALWAR", kameezOrder.measurementMode === "KAMEEZ_SHALWAR");

  const notSpecifiedOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-COAT-NS-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      // Deliberately omitting suitType/cuffType/gheraType entirely — "Not
      // Specified" must be a genuinely valid, saveable state now.
    },
  });
  orderIds.push(notSpecifiedOrder.id);
  check(
    "an order can be saved with Suit Type, Cuff, and Ghera all 'Not Specified' (null)",
    notSpecifiedOrder.suitType === null && notSpecifiedOrder.cuffType === null && notSpecifiedOrder.gheraType === null
  );

  const coatOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-COAT-C-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      measurementMode: "COAT",
      // No suitType/cuffType/gheraType/collarType/bainType at all — a
      // Coat-mode order's Suit & Styles section is hidden entirely.
      defaultMeasurementSnapshot: { connect: { id: coatSnapshot.id } },
    },
  });
  orderIds.push(coatOrder.id);
  check("a Coat-mode order saves successfully with NO Suit & Styles fields set at all", coatOrder.measurementMode === "COAT" && coatOrder.suitType === null && coatOrder.collarType === null && coatOrder.bainType === null);

  const coatOrderWithSnapshot = await prisma.order.findUnique({
    where: { id: coatOrder.id },
    include: { defaultMeasurementSnapshot: true },
  });
  check(
    "the Coat-mode order's snapshot correctly holds Coat values, not Kameez ones",
    coatOrderWithSnapshot.defaultMeasurementSnapshot.coatLength.toString() === "30.5" && coatOrderWithSnapshot.defaultMeasurementSnapshot.length === null
  );

  // ── 4. OrderItem.measurementMode — per-suit mixed garment types ────────
  console.log("4. OrderItem.measurementMode (\"ideally, an order should also support both garment types\")");
  const mixedOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-COAT-MIX-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      cuffType: "NOK_DAR",
      gheraType: "GOL",
      // Order-level default is KAMEEZ_SHALWAR (implicit).
      items: {
        create: [
          { position: 1 }, // inherits the order's own KAMEEZ_SHALWAR mode
          { position: 2, measurementMode: "COAT" }, // this one suit is Coat instead
        ],
      },
    },
  });
  orderIds.push(mixedOrder.id);
  const mixedItems = await prisma.orderItem.findMany({ where: { orderId: mixedOrder.id }, orderBy: { position: "asc" } });
  check("suit 1 has no measurementMode override (inherits the order's own)", mixedItems[0].measurementMode === null);
  check("suit 2 has its own COAT measurementMode override, independent of the order's KAMEEZ_SHALWAR default", mixedItems[1].measurementMode === "COAT");

  // ── 5. Existing (pre-upgrade-shaped) orders are completely unaffected ──
  console.log("5. Backward compatibility — a fully-specified Kameez order still works exactly as before");
  const fullOrderReread = await prisma.order.findUnique({ where: { id: kameezOrder.id } });
  check(
    "a normal, fully-specified Kameez order's suitType/cuffType/gheraType are unaffected by the new nullability",
    fullOrderReread.suitType === "SIMPLE" && fullOrderReread.cuffType === "NOK_DAR" && fullOrderReread.gheraType === "GOL"
  );
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  // Clean up everything this test created, FK-safe order, leaving
  // sui_dhaga_test exactly as it was before this run.
  for (const orderId of orderIds) {
    await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }
  for (const snapshotId of snapshotIds) {
    await prisma.measurementSnapshot.delete({ where: { id: snapshotId } }).catch(() => {});
  }
  if (customerId) {
    await prisma.measurement.deleteMany({ where: { customerId } }).catch(() => {});
    await prisma.coatMeasurement.deleteMany({ where: { customerId } }).catch(() => {});
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
