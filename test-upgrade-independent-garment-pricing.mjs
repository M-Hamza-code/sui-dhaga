// Regression test for "Explicit Garment Selection" — the correction that
// REPLACED this project's earlier content-based Prince Coat/Waistcoat
// pricing detection (which inferred garment inclusion from which
// measurement fields happened to have values — rejected because pricing
// must never depend on measurement content; an admin could forget a
// field and silently under-charge).
//
// Every Coat-mode OrderItem now has its own explicit, admin-chosen
// `coatGarmentSelection` (CoatGarmentSelection: PRINCE_COAT | WAISTCOAT |
// BOTH), completely independent of its measurement snapshot's content.
// This test exercises that field directly at the schema/data-model layer
// — the same resolution src/app/customers/[customerId]/orders/[orderId]/
// page.tsx, src/app/customers/[customerId]/orders/[orderId]/receipt/
// page.tsx (via src/lib/order-print-data.ts), and
// src/components/orders/order-form.tsx all now use:
//   - PRINCE_COAT or BOTH -> counts toward princeCoatQuantity
//   - WAISTCOAT or BOTH   -> counts toward waistcoatQuantity
//   - NULL (pre-upgrade Coat item) -> treated as BOTH for backward
//     compatibility, never re-derived from content
//
// Deliberately duplicates that tiny resolution rule inline rather than
// importing the real .ts modules — same reasoning as every other
// test-upgrade-*.mjs file in this project: this runner executes plain
// .mjs files with plain `node`, no TypeScript loader, so a .ts module
// isn't importable here.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-independent-garment-pricing.mjs

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

/** Mirrors the resolution rule now duplicated across order-form.tsx (resolveCoatItemInclusion), the Order Detail page, and the Receipt page (via order-print-data.ts's own NULL -> "BOTH" fallback). */
function tallyCoatQuantities(coatModeItems) {
  let princeCoatQuantity = 0;
  let waistcoatQuantity = 0;
  for (const item of coatModeItems) {
    const selection = item.coatGarmentSelection ?? "BOTH";
    if (selection === "PRINCE_COAT" || selection === "BOTH") princeCoatQuantity++;
    if (selection === "WAISTCOAT" || selection === "BOTH") waistcoatQuantity++;
  }
  return { princeCoatQuantity, waistcoatQuantity };
}

const suffix = Date.now();
let customerId = null;
const orderIds = [];

try {
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-EXPLICIT-${suffix}`, name: "Explicit Garment Selection Test Customer", phonePrimary: "03000000004" },
  });
  customerId = customer.id;

  // ── 1. Prince Coat Only — explicit selection, zero measurement fields
  //      filled in at all (proves pricing is NOT content-derived: an
  //      entry with literally no measurements still correctly charges
  //      for exactly the garment selected). ───────────────────────────
  console.log("1. Prince Coat Only (explicit selection, no measurement content at all)");
  const princeCoatOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-EXPLICIT-PC-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: { create: [{ position: 1, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" }] },
    },
    include: { items: true },
  });
  orderIds.push(princeCoatOnlyOrder.id);
  {
    const { princeCoatQuantity, waistcoatQuantity } = tallyCoatQuantities(princeCoatOnlyOrder.items);
    check("Prince Coat Only: princeCoatQuantity = 1", princeCoatQuantity === 1);
    check("Prince Coat Only: waistcoatQuantity = 0 (never auto-charged for a Waistcoat)", waistcoatQuantity === 0);
    check("Prince Coat Only: saved coatGarmentSelection is exactly PRINCE_COAT", princeCoatOnlyOrder.items[0].coatGarmentSelection === "PRINCE_COAT");
  }

  // ── 2. Waistcoat Only — explicit selection ──────────────────────────
  console.log("2. Waistcoat Only (explicit selection)");
  const waistcoatOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-EXPLICIT-WC-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: { create: [{ position: 1, measurementMode: "COAT", coatGarmentSelection: "WAISTCOAT" }] },
    },
    include: { items: true },
  });
  orderIds.push(waistcoatOnlyOrder.id);
  {
    const { princeCoatQuantity, waistcoatQuantity } = tallyCoatQuantities(waistcoatOnlyOrder.items);
    check("Waistcoat Only: princeCoatQuantity = 0 (never auto-charged for a Prince Coat)", princeCoatQuantity === 0);
    check("Waistcoat Only: waistcoatQuantity = 1", waistcoatQuantity === 1);
    check("Waistcoat Only: saved coatGarmentSelection is exactly WAISTCOAT", waistcoatOnlyOrder.items[0].coatGarmentSelection === "WAISTCOAT");
  }

  // ── 3. Both — explicit selection on a single entry ──────────────────
  console.log("3. Both (explicit selection)");
  const bothOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-EXPLICIT-BOTH-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: { create: [{ position: 1, measurementMode: "COAT", coatGarmentSelection: "BOTH" }] },
    },
    include: { items: true },
  });
  orderIds.push(bothOrder.id);
  {
    const { princeCoatQuantity, waistcoatQuantity } = tallyCoatQuantities(bothOrder.items);
    check("Both: princeCoatQuantity = 1", princeCoatQuantity === 1);
    check("Both: waistcoatQuantity = 1", waistcoatQuantity === 1);
    const princeCoatTotal = princeCoatQuantity > 0 ? Number(bothOrder.princeCoatUnitPrice) * princeCoatQuantity : null;
    const waistcoatTotal = waistcoatQuantity > 0 ? Number(bothOrder.waistcoatUnitPrice) * waistcoatQuantity : null;
    check("Both: Prince Coat subtotal = 5000.00 (its own quantity × its own unit price)", princeCoatTotal === 5000);
    check("Both: Waistcoat subtotal = 3000.00 (its own quantity × its own unit price)", waistcoatTotal === 3000);
  }

  // ── 4. Multiple entries with DIFFERENT selections and the resulting
  //      different garment quantities, on one order ──────────────────
  console.log("4. Multiple entries, different selections, different quantities");
  const mixSelectionOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-EXPLICIT-MIX-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      princeCoatUnitPrice: "5500.00",
      waistcoatUnitPrice: "3500.00",
      items: {
        create: [
          { position: 1, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" },
          { position: 2, measurementMode: "COAT", coatGarmentSelection: "WAISTCOAT" },
          { position: 3, measurementMode: "COAT", coatGarmentSelection: "BOTH" },
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
  orderIds.push(mixSelectionOrder.id);
  {
    const { princeCoatQuantity, waistcoatQuantity } = tallyCoatQuantities(mixSelectionOrder.items);
    check("Mixed selections: princeCoatQuantity = 2 (entry 1 + entry 3, NOT entry 2)", princeCoatQuantity === 2);
    check("Mixed selections: waistcoatQuantity = 2 (entry 2 + entry 3, NOT entry 1)", waistcoatQuantity === 2);
    const princeCoatTotal = princeCoatQuantity > 0 ? Number(mixSelectionOrder.princeCoatUnitPrice) * princeCoatQuantity : null;
    const waistcoatTotal = waistcoatQuantity > 0 ? Number(mixSelectionOrder.waistcoatUnitPrice) * waistcoatQuantity : null;
    check("Mixed selections: Prince Coat subtotal = 11000.00 (2 × 5500, own quantity/price only)", princeCoatTotal === 11000);
    check("Mixed selections: Waistcoat subtotal = 7000.00 (2 × 3500, own quantity/price only)", waistcoatTotal === 7000);
  }

  // ── 5. Mixed Kameez/Shalwar + Coat order, with explicit Coat selections ─
  console.log("5. Mixed Kameez/Shalwar + Coat/Waistcoat order");
  const mixedGarmentTypeOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-EXPLICIT-KC-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      cuffType: "NOK_DAR",
      gheraType: "GOL",
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: {
        create: [
          { position: 1 }, // Kameez suit 1
          { position: 2 }, // Kameez suit 2
          { position: 3, measurementMode: "COAT", coatGarmentSelection: "WAISTCOAT" }, // Coat entry 1
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
  orderIds.push(mixedGarmentTypeOrder.id);
  const coatModeItems = mixedGarmentTypeOrder.items.filter((i) => i.measurementMode === "COAT");
  check("Mixed Kameez+Coat order: exactly 1 Coat-mode item, 2 Kameez items", coatModeItems.length === 1 && mixedGarmentTypeOrder.items.length === 3);
  {
    const { princeCoatQuantity, waistcoatQuantity } = tallyCoatQuantities(coatModeItems);
    check("Mixed Kameez+Coat order: Waistcoat-only selection correctly excludes Prince Coat", princeCoatQuantity === 0 && waistcoatQuantity === 1);
  }

  // ── 6. Historical NULL selection fallback — a Coat item saved BEFORE
  //      this field existed (simulated by explicitly omitting it, which
  //      leaves the column NULL) must resolve as BOTH, matching the only
  //      behavior that existed before this upgrade. ───────────────────
  console.log("6. Historical NULL coatGarmentSelection falls back to BOTH");
  const legacyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-EXPLICIT-LEGACY-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: { create: [{ position: 1, measurementMode: "COAT" }] }, // coatGarmentSelection omitted entirely -> NULL
    },
    include: { items: true },
  });
  orderIds.push(legacyOrder.id);
  check("Historical item: coatGarmentSelection is genuinely NULL in the database", legacyOrder.items[0].coatGarmentSelection === null);
  {
    const { princeCoatQuantity, waistcoatQuantity } = tallyCoatQuantities(legacyOrder.items);
    check("Historical item: NULL resolves as BOTH -> princeCoatQuantity = 1", princeCoatQuantity === 1);
    check("Historical item: NULL resolves as BOTH -> waistcoatQuantity = 1", waistcoatQuantity === 1);
  }

  // ── 7. Historical price preservation — re-reading an already-saved
  //      order's own frozen unit prices and selections, unaffected by
  //      anything saved afterward. ─────────────────────────────────────
  console.log("7. Historical price preservation — re-reading an already-saved order");
  const reread = await prisma.order.findUnique({
    where: { id: princeCoatOnlyOrder.id },
    include: { items: true },
  });
  check(
    "Prince Coat Only order's own frozen unit prices are unchanged on reread",
    reread.princeCoatUnitPrice.toString() === "5000" && reread.waistcoatUnitPrice.toString() === "3000"
  );
  check("Prince Coat Only order's own saved selection is unchanged on reread", reread.items[0].coatGarmentSelection === "PRINCE_COAT");

  // ── 8. getOrderPrintData()'s own resolution shape — this is the exact
  //      query shape the Order Detail page, Receipt page, and Edit page
  //      all read through (see order-print-data.ts). Confirms a
  //      reconstructed "suits" array (its own included fields) resolves
  //      coatGarmentSelection the same NULL -> BOTH way. ───────────────
  console.log("8. order-print-data.ts's own query shape resolves coatGarmentSelection correctly");
  const printShapeOrder = await prisma.order.findUnique({
    where: { id: mixSelectionOrder.id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  const suits = printShapeOrder.items.map((item) => ({
    position: item.position,
    measurementMode: item.measurementMode ?? printShapeOrder.measurementMode,
    coatGarmentSelection: item.coatGarmentSelection ?? "BOTH",
  }));
  check(
    "getOrderPrintData()-shaped suits array resolves each entry's own explicit selection correctly",
    suits[0].coatGarmentSelection === "PRINCE_COAT" && suits[1].coatGarmentSelection === "WAISTCOAT" && suits[2].coatGarmentSelection === "BOTH"
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
  await prisma.$disconnect();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
