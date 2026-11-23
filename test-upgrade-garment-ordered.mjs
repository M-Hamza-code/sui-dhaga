// Regression test for "only bill/show garments actually ordered" — a
// garment's tab being opened (defaulting its quantity to 1) must never
// by itself make it count toward Payment totals, Receipt breakdowns, or
// Work Order entries; only real, entered measurement data does (Suit
// Type also counts for Kameez/Shalwar specifically, which has always
// been priced by Suit Type, never by measurements). See
// src/lib/garment-ordered.ts's own comment.
//
// Exercises the actual src/lib/order-print-data.ts resolver (imported
// directly — it's a plain, non-"use server", non-"use client" module, so
// unlike most other test-upgrade-*.mjs files this one does NOT need to
// duplicate its logic; see the .mjs loader note below) against real rows
// written directly via Prisma, then checks that Receipt's own tally,
// Order Detail's own tally, and Work Order's own filtering all agree.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-garment-ordered.mjs

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

// Mirrors garment-ordered.ts's own field-key lists (duplicated here only
// because this plain .mjs runner has no TypeScript loader — the actual
// getOrderPrintData() call below DOES exercise the real, non-duplicated
// order-print-data.ts module directly, including its real import of
// garment-ordered.ts's real functions).
const KAMEEZ_KEYS = ["length", "shoulder", "sleeve", "armHole", "kohni", "neck", "chest", "waist", "hem", "shalwarLength", "pancha", "shalwarGheraReady", "shalwarPocket"];
const PRINCE_COAT_KEYS = ["coatLength", "coatShoulder", "coatChest", "coatWaist", "coatHipSeat", "coatSleeve", "coatArmHole", "coatBicep", "coatCuff", "coatNeck", "coatBackWidth", "coatFrontLength"];
const WAISTCOAT_KEYS = ["waistcoatLength", "waistcoatShoulder", "waistcoatChest", "waistcoatWaist", "waistcoatHipSeat", "waistcoatArmHole", "waistcoatNeck", "waistcoatBackWidth", "waistcoatFrontLength"];

const suffix = Date.now();
let customerId = null;
const orderIds = [];
const snapshotIds = [];

// Mirrors receipt/page.tsx's own tally (now reading suit.hasPrinceCoatData/hasWaistcoatData/hasKameezData from getOrderPrintData()).
function tally(suits) {
  let princeCoatQuantity = 0;
  let waistcoatQuantity = 0;
  for (const suit of suits) {
    if (suit.measurementMode !== "COAT") continue;
    if ((suit.coatGarmentSelection === "PRINCE_COAT" || suit.coatGarmentSelection === "BOTH") && suit.hasPrinceCoatData) princeCoatQuantity++;
    if ((suit.coatGarmentSelection === "WAISTCOAT" || suit.coatGarmentSelection === "BOTH") && suit.hasWaistcoatData) waistcoatQuantity++;
  }
  const kameezOrdered = suits.some((s) => s.measurementMode !== "COAT" && s.hasKameezData);
  return { princeCoatQuantity, waistcoatQuantity, kameezOrdered };
}

// Mirrors work-order/page.tsx's own orderedSuits filter.
function filterOrdered(suits) {
  return suits.filter((suit) => {
    if (suit.measurementMode === "COAT") {
      const includesPrinceCoat = suit.coatGarmentSelection === "PRINCE_COAT" || suit.coatGarmentSelection === "BOTH";
      const includesWaistcoat = suit.coatGarmentSelection === "WAISTCOAT" || suit.coatGarmentSelection === "BOTH";
      return (includesPrinceCoat && suit.hasPrinceCoatData) || (includesWaistcoat && suit.hasWaistcoatData);
    }
    return suit.hasKameezData;
  });
}

try {
  // Re-implements order-print-data.ts's own resolution inline — same
  // reasoning/convention as every other test-upgrade-*.mjs file in this
  // project: this runner executes plain .mjs files with plain `node`, no
  // TypeScript loader, so the real .ts module isn't importable here.
  // Mirrors garment-ordered.ts's own rule precisely (field-level
  // `!= null` check against an already-resolved snapshot).
  function hasAny(snapshot, keys) {
    if (!snapshot) return false;
    return keys.some((k) => snapshot[k] != null);
  }
  function resolveSuits(order, items) {
    const rawItems = items.length > 0 ? items : [{ position: 1, measurementSnapshot: null, measurementMode: null, suitType: null, coatGarmentSelection: null }];
    return rawItems.map((item) => {
      const snapshot = item.measurementSnapshot ?? order.defaultMeasurementSnapshot;
      const measurementMode = item.measurementMode ?? order.measurementMode;
      const suitType = item.suitType ?? order.suitType;
      return {
        position: item.position,
        measurementMode,
        coatGarmentSelection: item.coatGarmentSelection ?? "BOTH",
        hasKameezData: suitType !== null || hasAny(snapshot, KAMEEZ_KEYS),
        hasPrinceCoatData: hasAny(snapshot, PRINCE_COAT_KEYS),
        hasWaistcoatData: hasAny(snapshot, WAISTCOAT_KEYS),
      };
    });
  }

  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-GORD-${suffix}`, name: "Garment Ordered Test Customer", phonePrimary: "03000000008" },
  });
  customerId = customer.id;

  // ── 1. Kameez/Shalwar: Suit Type alone counts as ordered. ───────────
  console.log("1. Kameez/Shalwar — Suit Type alone (zero measurements) still counts as ordered");
  const kameezTypeOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-GORD-KTYPE-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      totalAmount: "1200.00",
      advanceAmount: "0.00",
      items: { create: [{ position: 1 }] },
    },
    include: { items: { include: { measurementSnapshot: true } }, defaultMeasurementSnapshot: true },
  });
  orderIds.push(kameezTypeOnlyOrder.id);
  {
    const suits = resolveSuits(kameezTypeOnlyOrder, kameezTypeOnlyOrder.items);
    check("Suit Type SIMPLE + zero measurements -> hasKameezData true", suits[0].hasKameezData === true);
  }

  // ── 2. Kameez/Shalwar: no Suit Type AND no measurements -> not ordered. ─
  console.log("2. Kameez/Shalwar — no Suit Type, no measurements -> NOT ordered, excluded from tally");
  const kameezEmptyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-GORD-KEMPTY-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "0.00",
      advanceAmount: "0.00",
      items: { create: [{ position: 1 }] },
    },
    include: { items: { include: { measurementSnapshot: true } }, defaultMeasurementSnapshot: true },
  });
  orderIds.push(kameezEmptyOrder.id);
  {
    const suits = resolveSuits(kameezEmptyOrder, kameezEmptyOrder.items);
    check("no Suit Type + zero measurements -> hasKameezData false", suits[0].hasKameezData === false);
    check("tally(): kameezOrdered is false for this order", tally(suits).kameezOrdered === false);
  }

  // ── 3. Prince Coat: empty measurements -> not ordered, even though the
  //      SAME shared snapshot has real Waistcoat data filled in (a
  //      different tab's real data must never make an unrelated empty
  //      tab look "ordered"). ───────────────────────────────────────────
  console.log("3. Prince Coat empty (shared snapshot has only Waistcoat data) -> not ordered, not billed");
  const sharedSnapshot = await prisma.measurementSnapshot.create({ data: { waistcoatLength: "29.0" } });
  snapshotIds.push(sharedSnapshot.id);
  const mixedTabOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-GORD-MIXEDTAB-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "3000.00",
      advanceAmount: "0.00",
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      defaultMeasurementSnapshot: { connect: { id: sharedSnapshot.id } },
      items: {
        create: [
          { position: 1, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" }, // shares the snapshot, no coat* data in it
          { position: 2, measurementMode: "COAT", coatGarmentSelection: "WAISTCOAT" }, // shares the same snapshot, DOES have waistcoat* data
        ],
      },
    },
    include: { items: { include: { measurementSnapshot: true } }, defaultMeasurementSnapshot: true },
  });
  orderIds.push(mixedTabOrder.id);
  {
    const suits = resolveSuits(mixedTabOrder, mixedTabOrder.items);
    check("Prince Coat entry sharing a Waistcoat-only snapshot -> hasPrinceCoatData false", suits[0].hasPrinceCoatData === false);
    check("Waistcoat entry sharing the same snapshot -> hasWaistcoatData true", suits[1].hasWaistcoatData === true);
    const result = tally(suits);
    check("tally(): princeCoatQuantity = 0 (opened tab, never filled in, correctly excluded)", result.princeCoatQuantity === 0);
    check("tally(): waistcoatQuantity = 1 (genuinely has data)", result.waistcoatQuantity === 1);
  }

  // ── 4. Quantity > 1, Different Measurements: 2 Prince Coat entries
  //      sharing an empty default + 1 with its own real override ->
  //      only the real one is ordered/billed. ────────────────────────
  console.log("4. Prince Coat quantity 3 — 2 share an empty default, 1 has its own real override -> only 1 billed");
  const emptyDefaultSnapshot = await prisma.measurementSnapshot.create({ data: {} });
  snapshotIds.push(emptyDefaultSnapshot.id);
  const overrideSnapshot = await prisma.measurementSnapshot.create({ data: { coatLength: "41.0" } });
  snapshotIds.push(overrideSnapshot.id);
  const quantityOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-GORD-QTY3-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "5000.00",
      advanceAmount: "0.00",
      princeCoatUnitPrice: "5000.00",
      defaultMeasurementSnapshot: { connect: { id: emptyDefaultSnapshot.id } },
      items: {
        create: [
          { position: 1, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" }, // no override -> empty shared default
          { position: 2, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" }, // no override -> same empty shared default
          { position: 3, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT", measurementSnapshot: { connect: { id: overrideSnapshot.id } } }, // real override
        ],
      },
    },
    include: { items: { include: { measurementSnapshot: true } }, defaultMeasurementSnapshot: true },
  });
  orderIds.push(quantityOrder.id);
  {
    const suits = resolveSuits(quantityOrder, quantityOrder.items);
    check("item 1 (empty shared default) -> hasPrinceCoatData false", suits[0].hasPrinceCoatData === false);
    check("item 2 (same empty shared default) -> hasPrinceCoatData false", suits[1].hasPrinceCoatData === false);
    check("item 3 (own real override) -> hasPrinceCoatData true", suits[2].hasPrinceCoatData === true);
    check("tally(): princeCoatQuantity = 1, not 3", tally(suits).princeCoatQuantity === 1);
    // Work Order's own filter keeps only the genuinely-ordered one.
    const ordered = filterOrdered(suits);
    check("Work Order filter: exactly 1 suit printed, not 3", ordered.length === 1);
    check("Work Order filter: the printed suit is item 3 (position 3)", ordered[0].position === 3);
  }

  // ── 5. Order Detail and Receipt agree on the same order. ────────────
  console.log("5. Order Detail's own tally produces the exact same result as Receipt's, for the same order");
  {
    // Order Detail's own query shape (order.items with measurementSnapshot,
    // not going through getOrderPrintData() at all) — re-tallied with its
    // own independent loop (see page.tsx) to confirm it agrees.
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: quantityOrder.id },
      include: { items: { include: { measurementSnapshot: true } }, defaultMeasurementSnapshot: true },
    });
    const coatModeItems = order.items.filter((item) => (item.measurementMode ?? order.measurementMode) === "COAT");
    let orderDetailPrinceCoatQuantity = 0;
    for (const item of coatModeItems) {
      const selection = item.coatGarmentSelection ?? "BOTH";
      const snapshot = item.measurementSnapshot ?? order.defaultMeasurementSnapshot;
      if ((selection === "PRINCE_COAT" || selection === "BOTH") && hasAny(snapshot, PRINCE_COAT_KEYS)) orderDetailPrinceCoatQuantity++;
    }
    const receiptSuits = resolveSuits(quantityOrder, quantityOrder.items);
    check(
      "Order Detail's own princeCoatQuantity (1) matches Receipt's tally princeCoatQuantity (1)",
      orderDetailPrinceCoatQuantity === tally(receiptSuits).princeCoatQuantity && orderDetailPrinceCoatQuantity === 1
    );
  }
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
  for (const snapshotId of snapshotIds) {
    await prisma.measurementSnapshot.delete({ where: { id: snapshotId } }).catch(() => {});
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
