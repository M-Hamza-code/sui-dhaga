// Regression test for "Independent Kameez/Shalwar and Coat/Waistcoat
// Order Sections + Garment Default Prices":
//   1. Settings' defaultPrices JSON gains PRINCE_COAT/WAISTCOAT keys,
//      independent of the existing SuitType-keyed prices.
//   2. Order.princeCoatUnitPrice/waistcoatUnitPrice (new additive columns).
//   3. A Kameez-only order, a Coat-only order, and a MIXED order (both
//      garment types on the same order, for the same customer) all save
//      correctly with the right per-position measurementMode.
//   4. A later Settings price change never touches an already-saved
//      order's own frozen princeCoatUnitPrice/waistcoatUnitPrice.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-independent-garment-sections.mjs
// Direct-Prisma only (no HTTP) — same reasoning as the other upgrade
// test files in this project: validateOrderInput/buildOrderCreateData are
// TypeScript, not importable from this plain-Node test runner, so this
// exercises the schema/data-model layer those functions write to and
// read from, duplicating the exact shape they produce for each scenario.

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
let settingsBackup = null;

try {
  // ── 1. Settings' PRINCE_COAT/WAISTCOAT default prices ──────────────────
  console.log("1. ShopSettings.defaultPrices — Prince Coat/Waistcoat keys");
  const existingSettings = await prisma.shopSettings.findUnique({ where: { singleton: true } });
  settingsBackup = existingSettings ? { defaultPrices: existingSettings.defaultPrices } : null;
  const existingPrices = existingSettings && typeof existingSettings.defaultPrices === "object" ? existingSettings.defaultPrices : {};
  const updatedPrices = { ...existingPrices, PRINCE_COAT: "5000.00", WAISTCOAT: "3000.00" };
  await prisma.shopSettings.upsert({
    where: { singleton: true },
    create: { singleton: true, name: "Test Shop", phone: "03000000000", defaultPrices: updatedPrices },
    update: { defaultPrices: updatedPrices },
  });
  const afterSettingsWrite = await prisma.shopSettings.findUnique({ where: { singleton: true } });
  check(
    "PRINCE_COAT/WAISTCOAT keys saved alongside any pre-existing SuitType keys",
    afterSettingsWrite.defaultPrices.PRINCE_COAT === "5000.00" && afterSettingsWrite.defaultPrices.WAISTCOAT === "3000.00"
  );
  check(
    "pre-existing Gum Silai/Double Silai (or any other SuitType) keys untouched",
    JSON.stringify(Object.fromEntries(Object.entries(existingPrices))) ===
      JSON.stringify(Object.fromEntries(Object.entries(afterSettingsWrite.defaultPrices).filter(([k]) => k in existingPrices)))
  );

  // ── 2. Customer + Coat profile (for prefill realism) ────────────────────
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-INDEP-${suffix}`, name: "Independent Sections Test Customer", phonePrimary: "03000000002" },
  });
  customerId = customer.id;

  // ── 3. Kameez-only order (coatQuantity 0) — unaffected by this upgrade ──
  console.log("2. Kameez/Shalwar-only order (coatQuantity 0)");
  const kameezOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-INDEP-K-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      cuffType: "NOK_DAR",
      gheraType: "GOL",
      items: { create: [{ position: 1 }, { position: 2 }] },
      // princeCoatUnitPrice/waistcoatUnitPrice intentionally omitted — null, exactly like before this upgrade existed.
    },
    include: { items: true },
  });
  orderIds.push(kameezOrder.id);
  check("Kameez-only order has 2 OrderItems, neither with a COAT measurementMode", kameezOrder.items.every((i) => i.measurementMode === null) && kameezOrder.items.length === 2);
  check("Kameez-only order has no Coat/Waistcoat unit prices set", kameezOrder.princeCoatUnitPrice === null && kameezOrder.waistcoatUnitPrice === null);

  // ── 4. Coat-only order (kameezQuantity 0) — no Suit & Styles at all ─────
  console.log("3. Coat/Waistcoat-only order (kameezQuantity 0)");
  const coatOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-INDEP-C-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      // suitType/cuffType/gheraType/collarType/bainType all omitted — null,
      // matching a Coat/Waistcoat-only order's own form submission (no
      // Suit & Styles section at all).
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: { create: [{ position: 1, measurementMode: "COAT" }, { position: 2, measurementMode: "COAT" }] },
    },
    include: { items: true },
  });
  orderIds.push(coatOnlyOrder.id);
  check(
    "Coat-only order has no Suit & Styles fields set at all",
    coatOnlyOrder.suitType === null && coatOnlyOrder.cuffType === null && coatOnlyOrder.gheraType === null && coatOnlyOrder.collarType === null && coatOnlyOrder.bainType === null
  );
  check("Coat-only order's 2 items are BOTH explicitly COAT (never inherited)", coatOnlyOrder.items.every((i) => i.measurementMode === "COAT"));
  check(
    "Coat-only order's own unit prices saved exactly as submitted",
    coatOnlyOrder.princeCoatUnitPrice.toString() === "5000" && coatOnlyOrder.waistcoatUnitPrice.toString() === "3000"
  );

  // ── 5. MIXED order — both garment types, same order, same customer ─────
  console.log("4. Mixed order — Kameez/Shalwar AND Coat/Waistcoat together");
  const mixedOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-INDEP-MIX-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      cuffType: "NOK_DAR",
      gheraType: "GOL",
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: {
        create: [
          { position: 1 }, // Kameez suit 1 — inherits the order's own style, measurementMode null
          { position: 2 }, // Kameez suit 2
          { position: 3, measurementMode: "COAT" }, // Coat entry 1 — global position continues right after Kameez
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
  orderIds.push(mixedOrder.id);
  check("mixed order has exactly 3 items", mixedOrder.items.length === 3);
  check(
    "positions 1-2 are Kameez/Shalwar (inherit the order's own KAMEEZ_SHALWAR mode)",
    mixedOrder.items[0].measurementMode === null && mixedOrder.items[1].measurementMode === null
  );
  check("position 3 is explicitly Coat/Waistcoat", mixedOrder.items[2].measurementMode === "COAT");
  check(
    "selecting 2 Kameez suits did not create 2 Coat entries, and vice versa — exactly 1 Coat entry alongside 2 Kameez suits",
    mixedOrder.items.filter((i) => i.measurementMode === "COAT").length === 1 && mixedOrder.items.filter((i) => i.measurementMode !== "COAT").length === 2
  );

  // Same customer, same visit: one Kameez-only order + one Coat-only order
  // + one mixed order, all created above for the SAME customerId — no
  // second customer record was ever needed.
  const customerOrders = await prisma.order.findMany({ where: { customerId } });
  check("the same customer has all 3 orders (Kameez-only, Coat-only, mixed) without needing a second customer record", customerOrders.length === 3);

  // ── 6. Requirement 7 — a later Settings price change never touches an
  //      already-saved order's own frozen unit price ─────────────────────
  console.log("5. Changing Settings' default price later does not change an existing order's frozen price");
  await prisma.shopSettings.update({
    where: { singleton: true },
    data: { defaultPrices: { ...updatedPrices, PRINCE_COAT: "9999.00", WAISTCOAT: "8888.00" } },
  });
  const coatOrderReread = await prisma.order.findUnique({ where: { id: coatOnlyOrder.id } });
  check(
    "the Coat-only order's own princeCoatUnitPrice/waistcoatUnitPrice are completely unaffected by the new Settings default",
    coatOrderReread.princeCoatUnitPrice.toString() === "5000" && coatOrderReread.waistcoatUnitPrice.toString() === "3000"
  );
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
  // Restore ShopSettings' defaultPrices to exactly what it was before this
  // test ran — never leave the test database's shared singleton row
  // mutated by a test run.
  if (settingsBackup) {
    await prisma.shopSettings.update({ where: { singleton: true }, data: { defaultPrices: settingsBackup.defaultPrices } }).catch(() => {});
  } else {
    await prisma.shopSettings.deleteMany({ where: { singleton: true } }).catch(() => {});
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
