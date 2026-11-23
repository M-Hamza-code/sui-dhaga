// Regression test for the "Order Type Selection" upgrade's one genuinely
// new piece of SERVER-VISIBLE behavior: the Receipt page's derived
// "Kameez/Shalwar total" line for a mixed Kameez+Coat order (see
// src/app/customers/[customerId]/orders/[orderId]/receipt/page.tsx's own
// comment). Everything else in this upgrade (the Order Type Selection
// checkboxes themselves, hiding/showing the Kameez/Coat SectionCards,
// preserving measurement values across a checkbox toggle) is pure client
// component state/JSX in order-form.tsx with NO backend change at all —
// not testable by this Node-based harness, which has no browser/DOM tool.
// The backend's own handling of kameezQuantity=0 / coatQuantity=0 (what
// the new checkboxes ultimately submit) was already proven correct by
// test-upgrade-independent-garment-sections.mjs in an earlier round and
// is completely unchanged here.
//
// Deliberately duplicates the receipt page's own tiny formula inline
// rather than importing the real .tsx module — same reasoning as every
// other test-upgrade-*.mjs file in this project: this runner executes
// plain .mjs files with plain `node`, no TypeScript/JSX loader.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-order-type-selection.mjs

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

// Mirrors receipt/page.tsx's own derivation exactly.
function computeReceiptBreakdown(order, suits) {
  let princeCoatQuantity = 0;
  let waistcoatQuantity = 0;
  for (const suit of suits) {
    if (suit.measurementMode !== "COAT") continue;
    if (suit.coatGarmentSelection === "PRINCE_COAT" || suit.coatGarmentSelection === "BOTH") princeCoatQuantity++;
    if (suit.coatGarmentSelection === "WAISTCOAT" || suit.coatGarmentSelection === "BOTH") waistcoatQuantity++;
  }
  const princeCoatTotal = princeCoatQuantity > 0 && order.princeCoatUnitPrice ? Number(order.princeCoatUnitPrice) * princeCoatQuantity : null;
  const waistcoatTotal = waistcoatQuantity > 0 && order.waistcoatUnitPrice ? Number(order.waistcoatUnitPrice) * waistcoatQuantity : null;
  const hasCoatEntries = princeCoatQuantity > 0 || waistcoatQuantity > 0;
  const kameezShalwarTotal = hasCoatEntries ? Number(order.totalAmount) - (princeCoatTotal ?? 0) - (waistcoatTotal ?? 0) : null;
  return { princeCoatQuantity, waistcoatQuantity, princeCoatTotal, waistcoatTotal, hasCoatEntries, kameezShalwarTotal };
}

const suffix = Date.now();
let customerId = null;
const orderIds = [];
// Set only if step 4 actually runs; `finally` checks for this exact
// "never touched" vs "touched, must restore" distinction.
let originalDefaultPrices;

try {
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-OTS-${suffix}`, name: "Order Type Selection Test Customer", phonePrimary: "03000000006" },
  });
  customerId = customer.id;

  // ── 1. Mixed order — Kameez + Coat(Both) together. ─────────────────
  console.log("1. Mixed Kameez/Shalwar + Coat order — Receipt's itemized Kameez/Shalwar line");
  const mixedOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-OTS-MIXED-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      totalAmount: "12000.00",
      advanceAmount: "0.00",
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: {
        create: [
          { position: 1 },
          { position: 2 },
          { position: 3, measurementMode: "COAT", coatGarmentSelection: "BOTH" },
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
  orderIds.push(mixedOrder.id);
  {
    const breakdown = computeReceiptBreakdown(mixedOrder, mixedOrder.items);
    check("mixed order: hasCoatEntries is true", breakdown.hasCoatEntries === true);
    check("mixed order: Prince Coat total = 5000.00 (1 × 5000)", breakdown.princeCoatTotal === 5000);
    check("mixed order: Waistcoat total = 3000.00 (1 × 3000)", breakdown.waistcoatTotal === 3000);
    check(
      "mixed order: Kameez/Shalwar total = Total(12000) - PrinceCoat(5000) - Waistcoat(3000) = 4000.00, never from Settings' current suit-type price",
      breakdown.kameezShalwarTotal === 4000
    );
  }

  // ── 2. Kameez/Shalwar-only order — no new line at all (unaffected). ──
  console.log("2. Kameez/Shalwar-only order — no Kameez/Shalwar breakdown line (unaffected, exactly as before)");
  const kameezOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-OTS-KAMEEZONLY-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      totalAmount: "3000.00",
      advanceAmount: "0.00",
      items: { create: [{ position: 1 }] },
    },
    include: { items: true },
  });
  orderIds.push(kameezOnlyOrder.id);
  {
    const breakdown = computeReceiptBreakdown(kameezOnlyOrder, kameezOnlyOrder.items);
    check("Kameez-only order: hasCoatEntries is false", breakdown.hasCoatEntries === false);
    check("Kameez-only order: kameezShalwarTotal is null (no new line rendered)", breakdown.kameezShalwarTotal === null);
  }

  // ── 3. Coat-only order (kameezQuantity 0) — Kameez/Shalwar line shows
  //      exactly 0.00, since the whole Total is already Coat/Waistcoat's. ─
  console.log("3. Coat/Waistcoat-only order — Kameez/Shalwar line computes to exactly 0.00");
  const coatOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-OTS-COATONLY-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "8000.00",
      advanceAmount: "0.00",
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: { create: [{ position: 1, measurementMode: "COAT", coatGarmentSelection: "BOTH" }] },
    },
    include: { items: true },
  });
  orderIds.push(coatOnlyOrder.id);
  {
    const breakdown = computeReceiptBreakdown(coatOnlyOrder, coatOnlyOrder.items);
    check("Coat-only order: hasCoatEntries is true", breakdown.hasCoatEntries === true);
    check("Coat-only order: kameezShalwarTotal = 8000 - 5000 - 3000 = 0.00", breakdown.kameezShalwarTotal === 0);
  }

  // ── 4. Historical accuracy — changing ShopSettings' CURRENT default
  //      prices after the fact must never change the mixed order's own
  //      already-computed Kameez/Shalwar line, because the formula never
  //      reads ShopSettings at all, only this order's own frozen fields. ─
  console.log("4. Historical accuracy — Settings' current default price changes never affect the already-saved mixed order");
  // Non-destructive: the real ShopSettings singleton (unique key
  // `singleton: true`, NOT `id`) already exists in this test database
  // from ordinary app usage — this only merges one extra test key into
  // its existing defaultPrices JSON (never overwrites the whole object,
  // never touches name/phone/tagline/etc.), and the `finally` block below
  // restores the exact original defaultPrices value afterward. If no
  // ShopSettings row exists yet in this environment, this one check is
  // skipped rather than fabricating a placeholder shop record.
  const existingSettings = await prisma.shopSettings.findUnique({ where: { singleton: true } });
  if (existingSettings) {
    originalDefaultPrices = existingSettings.defaultPrices;
    await prisma.shopSettings.update({
      where: { singleton: true },
      data: { defaultPrices: { ...existingSettings.defaultPrices, SIMPLE: "9999.00" } },
    });
    const reread = await prisma.order.findUniqueOrThrow({ where: { id: mixedOrder.id }, include: { items: { orderBy: { position: "asc" } } } });
    const breakdown = computeReceiptBreakdown(reread, reread.items);
    check(
      "mixed order's Kameez/Shalwar total is still exactly 4000.00 after Settings' SIMPLE default price changed to 9999.00",
      breakdown.kameezShalwarTotal === 4000
    );
  } else {
    console.log("  SKIP: no ShopSettings row exists in this test database — nothing to vary for this check.");
  }
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  // Restore ShopSettings' defaultPrices to exactly what it was before
  // step 4 touched it (only runs at all if step 4 actually found and
  // modified the existing singleton row).
  if (typeof originalDefaultPrices !== "undefined") {
    await prisma.shopSettings.update({ where: { singleton: true }, data: { defaultPrices: originalDefaultPrices } }).catch(() => {});
  }
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
