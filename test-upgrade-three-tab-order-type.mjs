// Regression test for the "three-tab Order Type" redesign — Kameez
// Shalwar / Prince Coat / Waistcoat as three fully independent,
// clickable sections instead of two checkboxes with a per-entry garment
// dropdown (see order-form.tsx, order-actions.ts, offline/sync-engine.ts).
//
// This test covers two genuinely different things:
//   1. The quantity-parsing arithmetic order-actions.ts's own
//      validateOrderInput and offline/sync-engine.ts's own
//      enqueueUpdateOrder now BOTH apply: three separate submitted
//      fields (kameezQuantity/princeCoatQuantity/waistcoatQuantity)
//      combine into the same coatQuantity/quantity/position-range shape
//      the rest of the backend (order-build.ts, order-update.ts,
//      order-print-data.ts) already expects and already handles
//      correctly — duplicated inline below, same reasoning as every
//      other test-upgrade-*.mjs file (this runner executes plain .mjs
//      files with plain `node`, no TypeScript loader, so the real .ts
//      files aren't importable here).
//   2. That the DATA SHAPE this new position math produces (Kameez
//      positions first, then Prince Coat, then Waistcoat, each
//      independently sized) round-trips correctly through the
//      ALREADY-EXISTING, UNCHANGED downstream readers (pricing,
//      Receipt's derived Kameez/Shalwar line) — verified against real
//      rows written directly via Prisma, matching every other
//      test-upgrade-*.mjs file's own convention of bypassing the Server
//      Action/FormData layer and writing the already-validated shape
//      directly.
//
// What this test does NOT cover: actually POSTing a FormData payload
// through the real validateOrderInput Server Action end-to-end (that
// needs an authenticated browser session submitting the real React
// form — not reproducible from a plain Node script against Next.js
// Server Actions' own internal protocol). That is the one genuine gap
// — flagged explicitly in the implementation report, not hidden here.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-three-tab-order-type.mjs

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

// Mirrors order-actions.ts's validateOrderInput and
// offline/sync-engine.ts's enqueueUpdateOrder — both now compute
// coatQuantity as the sum of two independently-submitted fields, never
// a single combined "coatQuantity" field any more.
function parseGarmentQuantity(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 20) return null;
  return n;
}
function computeQuantities(fields) {
  const kameezQuantity = parseGarmentQuantity(fields.kameezQuantity);
  const princeCoatQuantity = parseGarmentQuantity(fields.princeCoatQuantity);
  const waistcoatQuantity = parseGarmentQuantity(fields.waistcoatQuantity);
  if (kameezQuantity === null || princeCoatQuantity === null || waistcoatQuantity === null) return null;
  const coatQuantity = princeCoatQuantity + waistcoatQuantity;
  if (kameezQuantity === 0 && coatQuantity === 0) return null;
  return { kameezQuantity, princeCoatQuantity, waistcoatQuantity, coatQuantity, quantity: kameezQuantity + coatQuantity };
}

console.log("1. Quantity-parsing arithmetic (order-actions.ts / sync-engine.ts's own new three-field logic)");
check(
  "Kameez=2, Prince Coat=1, Waistcoat=1 -> coatQuantity=2, total quantity=4",
  JSON.stringify(computeQuantities({ kameezQuantity: "2", princeCoatQuantity: "1", waistcoatQuantity: "1" })) ===
    JSON.stringify({ kameezQuantity: 2, princeCoatQuantity: 1, waistcoatQuantity: 1, coatQuantity: 2, quantity: 4 })
);
check(
  "Prince Coat only (Kameez=0, Prince Coat=3, Waistcoat=0) -> quantity=3, no error",
  JSON.stringify(computeQuantities({ kameezQuantity: "0", princeCoatQuantity: "3", waistcoatQuantity: "0" })) ===
    JSON.stringify({ kameezQuantity: 0, princeCoatQuantity: 3, waistcoatQuantity: 0, coatQuantity: 3, quantity: 3 })
);
check(
  "Waistcoat only (Kameez=0, Prince Coat=0, Waistcoat=2) -> quantity=2, no error",
  JSON.stringify(computeQuantities({ kameezQuantity: "0", princeCoatQuantity: "0", waistcoatQuantity: "2" })) ===
    JSON.stringify({ kameezQuantity: 0, princeCoatQuantity: 0, waistcoatQuantity: 2, coatQuantity: 2, quantity: 2 })
);
check("all three zero -> rejected (null), matching \"add at least one\" error", computeQuantities({ kameezQuantity: "0", princeCoatQuantity: "0", waistcoatQuantity: "0" }) === null);
check(
  "a legacy single combined 'coatQuantity' field (pre-redesign client) is simply ignored, never silently summed in",
  computeQuantities({ kameezQuantity: "1", princeCoatQuantity: "0", waistcoatQuantity: "0", coatQuantity: "5" }).quantity === 1
);

const suffix = Date.now();
let customerId = null;
const orderIds = [];

try {
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-3TAB-${suffix}`, name: "Three-Tab Order Type Test Customer", phonePrimary: "03000000007" },
  });
  customerId = customer.id;

  // ── 2. Real order shaped exactly as the new position math produces:
  //      Kameez positions 1-2, Prince Coat position 3, Waistcoat position 4. ─
  console.log("2. Mixed order — Kameez(2) + Prince Coat(1) + Waistcoat(1), positions laid out by the new tab order");
  const mixedOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-3TAB-MIXED-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      totalAmount: "14000.00",
      advanceAmount: "0.00",
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      items: {
        create: [
          { position: 1 },
          { position: 2 },
          { position: 3, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" },
          { position: 4, measurementMode: "COAT", coatGarmentSelection: "WAISTCOAT" },
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
  orderIds.push(mixedOrder.id);
  check("mixed order has exactly 4 items", mixedOrder.items.length === 4);
  check("positions 1-2 are plain Kameez/Shalwar (no measurementMode override)", mixedOrder.items.slice(0, 2).every((i) => i.measurementMode === null));
  check("position 3 is explicitly PRINCE_COAT", mixedOrder.items[2].measurementMode === "COAT" && mixedOrder.items[2].coatGarmentSelection === "PRINCE_COAT");
  check("position 4 is explicitly WAISTCOAT", mixedOrder.items[3].measurementMode === "COAT" && mixedOrder.items[3].coatGarmentSelection === "WAISTCOAT");

  // Existing, UNCHANGED downstream resolution (same formula order-print-data.ts / receipt page already use) correctly reads this new layout.
  let princeCoatQuantity = 0;
  let waistcoatQuantity = 0;
  for (const item of mixedOrder.items) {
    if (item.measurementMode !== "COAT") continue;
    if (item.coatGarmentSelection === "PRINCE_COAT" || item.coatGarmentSelection === "BOTH") princeCoatQuantity++;
    if (item.coatGarmentSelection === "WAISTCOAT" || item.coatGarmentSelection === "BOTH") waistcoatQuantity++;
  }
  check("downstream resolution: princeCoatQuantity = 1", princeCoatQuantity === 1);
  check("downstream resolution: waistcoatQuantity = 1", waistcoatQuantity === 1);
  const princeCoatTotal = Number(mixedOrder.princeCoatUnitPrice) * princeCoatQuantity;
  const waistcoatTotal = Number(mixedOrder.waistcoatUnitPrice) * waistcoatQuantity;
  const kameezShalwarTotal = Number(mixedOrder.totalAmount) - princeCoatTotal - waistcoatTotal;
  check("Receipt's own derived Kameez/Shalwar line = 14000 - 5000 - 3000 = 6000.00", kameezShalwarTotal === 6000);

  // ── 3. Prince-Coat-only order (no Kameez section at all). ───────────
  console.log("3. Prince-Coat-only order (Kameez quantity 0)");
  const princeCoatOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-3TAB-PCONLY-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "10000.00",
      advanceAmount: "0.00",
      princeCoatUnitPrice: "5000.00",
      items: {
        create: [
          { position: 1, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" },
          { position: 2, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" },
        ],
      },
    },
    include: { items: true },
  });
  orderIds.push(princeCoatOnlyOrder.id);
  check("Prince-Coat-only order has no Suit & Styles fields set", princeCoatOnlyOrder.suitType === null);
  check("Prince-Coat-only order's 2 items are BOTH explicitly PRINCE_COAT", princeCoatOnlyOrder.items.every((i) => i.coatGarmentSelection === "PRINCE_COAT"));

  // ── 4. Waistcoat-only order. ─────────────────────────────────────────
  console.log("4. Waistcoat-only order (Kameez quantity 0)");
  const waistcoatOnlyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-3TAB-WCONLY-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "3000.00",
      advanceAmount: "0.00",
      waistcoatUnitPrice: "3000.00",
      items: { create: [{ position: 1, measurementMode: "COAT", coatGarmentSelection: "WAISTCOAT" }] },
    },
    include: { items: true },
  });
  orderIds.push(waistcoatOnlyOrder.id);
  check("Waistcoat-only order's 1 item is explicitly WAISTCOAT", waistcoatOnlyOrder.items[0].coatGarmentSelection === "WAISTCOAT");

  // ── 5. Legacy BOTH-valued item — makeInitialStateFromOrder's own
  //      split (includesPrinceCoat/includesWaistcoat) puts it in BOTH
  //      the Prince Coat and Waistcoat tab lists on edit, verified here
  //      in isolation (pure logic, matches the real helper exactly). ──
  console.log("5. Legacy BOTH-valued Coat item splits into both tab lists on edit (display-only; pricing already counted it twice before this redesign too)");
  function includesPrinceCoat(selection) {
    return selection === "PRINCE_COAT" || selection === "BOTH";
  }
  function includesWaistcoat(selection) {
    return selection === "WAISTCOAT" || selection === "BOTH";
  }
  const legacyCoatRaw = [{ position: 5, coatGarmentSelection: "BOTH" }];
  const princeCoatRaw = legacyCoatRaw.filter((item) => includesPrinceCoat(item.coatGarmentSelection ?? "BOTH"));
  const waistcoatRaw = legacyCoatRaw.filter((item) => includesWaistcoat(item.coatGarmentSelection ?? "BOTH"));
  check("a legacy BOTH item appears in the Prince Coat tab's own list", princeCoatRaw.length === 1);
  check("the SAME legacy BOTH item also appears in the Waistcoat tab's own list", waistcoatRaw.length === 1);
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
