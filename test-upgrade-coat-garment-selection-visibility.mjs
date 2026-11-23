// Regression test for the "measurement-group visibility" fix — the
// shared/default Coat measurement block (and the Order Detail/Work Order
// read-only displays) must show exactly the UNION of garment groups
// actually needed by the entries that rely on them, computed from each
// entry's own explicit, persisted `coatGarmentSelection` — never from
// measurement content, and never changing pricing (src/lib/order-actions.ts,
// src/lib/order-build.ts are completely untouched by this fix).
//
// Deliberately duplicates src/lib/coat-garment-selection.ts's own tiny
// union/inclusion rule inline rather than importing the real .ts module —
// same reasoning as every other test-upgrade-*.mjs file in this project:
// this runner executes plain .mjs files with plain `node`, no TypeScript
// loader, so a .ts module isn't importable here.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-coat-garment-selection-visibility.mjs

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

// Mirrors src/lib/coat-garment-selection.ts exactly.
function includesPrinceCoat(selection) {
  return selection === "PRINCE_COAT" || selection === "BOTH";
}
function includesWaistcoat(selection) {
  return selection === "WAISTCOAT" || selection === "BOTH";
}
function unionCoatGarmentSelection(selections) {
  if (selections.length === 0) return null;
  const hasPrinceCoat = selections.some(includesPrinceCoat);
  const hasWaistcoat = selections.some(includesWaistcoat);
  if (hasPrinceCoat && hasWaistcoat) return "BOTH";
  if (hasPrinceCoat) return "PRINCE_COAT";
  return "WAISTCOAT";
}

/** Mirrors order-form.tsx's computeSharedCoatVisibleGroup / page.tsx's sharedCoatVisibleGroup: union over entries WITHOUT their own override ("relies on the shared block"), falling back to BOTH when none exist. */
function computeSharedVisibleGroup(items) {
  const relevant = items.filter((item) => !item.hasOwnOverride).map((item) => item.coatGarmentSelection ?? "BOTH");
  return unionCoatGarmentSelection(relevant) ?? "BOTH";
}

const suffix = Date.now();
let customerId = null;
const orderIds = [];
const snapshotIds = [];

try {
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-VIS-${suffix}`, name: "Garment Selection Visibility Test Customer", phonePrimary: "03000000005" },
  });
  customerId = customer.id;

  // ── 1. Union rule — pure logic, no DB needed, but exercised against
  //      the exact same shapes the real pages compute it from. ────────
  console.log("1. Shared visibility union rule");
  check(
    "one PRINCE_COAT-only entry (no override) -> PRINCE_COAT",
    computeSharedVisibleGroup([{ hasOwnOverride: false, coatGarmentSelection: "PRINCE_COAT" }]) === "PRINCE_COAT"
  );
  check(
    "one WAISTCOAT-only entry (no override) -> WAISTCOAT",
    computeSharedVisibleGroup([{ hasOwnOverride: false, coatGarmentSelection: "WAISTCOAT" }]) === "WAISTCOAT"
  );
  check(
    "one PRINCE_COAT-only + one WAISTCOAT-only (both no override) -> BOTH",
    computeSharedVisibleGroup([
      { hasOwnOverride: false, coatGarmentSelection: "PRINCE_COAT" },
      { hasOwnOverride: false, coatGarmentSelection: "WAISTCOAT" },
    ]) === "BOTH"
  );
  check(
    "a lone BOTH entry (no override) -> BOTH",
    computeSharedVisibleGroup([{ hasOwnOverride: false, coatGarmentSelection: "BOTH" }]) === "BOTH"
  );
  check(
    "every entry has its own override (none rely on the shared block) -> falls back to BOTH",
    computeSharedVisibleGroup([{ hasOwnOverride: true, coatGarmentSelection: "PRINCE_COAT" }]) === "BOTH"
  );
  check(
    "a legacy NULL selection among the relevant entries resolves as BOTH inside the union",
    computeSharedVisibleGroup([
      { hasOwnOverride: false, coatGarmentSelection: null },
      { hasOwnOverride: false, coatGarmentSelection: "PRINCE_COAT" },
    ]) === "BOTH"
  );
  check(
    "mixing an overridden entry's selection must NOT influence the shared block's own union (only non-overridden entries count)",
    computeSharedVisibleGroup([
      { hasOwnOverride: true, coatGarmentSelection: "WAISTCOAT" }, // irrelevant — has its own override
      { hasOwnOverride: false, coatGarmentSelection: "PRINCE_COAT" },
    ]) === "PRINCE_COAT"
  );

  // ── 2. Real order: Prince-Coat-only entry + Waistcoat-only entry,
  //      BOTH relying on the shared default snapshot (no override) —
  //      confirms the shared snapshot's own disjoint coat*/waistcoat*
  //      columns can hold both groups' data at once, independent of
  //      which entry "needs" which, and that this never changes pricing. ─
  console.log("2. Real order — two non-overridden entries, different selections, shared snapshot");
  const sharedSnapshot = await prisma.measurementSnapshot.create({
    data: { coatLength: "41.0", waistcoatLength: "29.0" },
  });
  snapshotIds.push(sharedSnapshot.id);
  const sharedOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-VIS-SHARED-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      princeCoatUnitPrice: "5000.00",
      waistcoatUnitPrice: "3000.00",
      defaultMeasurementSnapshot: { connect: { id: sharedSnapshot.id } },
      items: {
        create: [
          { position: 1, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT" }, // no own override -> inherits shared snapshot
          { position: 2, measurementMode: "COAT", coatGarmentSelection: "WAISTCOAT" }, // no own override -> inherits shared snapshot
        ],
      },
    },
    include: { items: { orderBy: { position: "asc" } }, defaultMeasurementSnapshot: true },
  });
  orderIds.push(sharedOrder.id);
  check("both entries have no own override (measurementSnapshotId null)", sharedOrder.items.every((i) => i.measurementSnapshotId === null));
  check(
    "the shared block's own visibility is BOTH (union of PRINCE_COAT + WAISTCOAT)",
    computeSharedVisibleGroup(
      sharedOrder.items.map((i) => ({ hasOwnOverride: i.measurementSnapshotId !== null, coatGarmentSelection: i.coatGarmentSelection }))
    ) === "BOTH"
  );
  {
    let princeCoatQuantity = 0;
    let waistcoatQuantity = 0;
    for (const item of sharedOrder.items) {
      const selection = item.coatGarmentSelection ?? "BOTH";
      if (includesPrinceCoat(selection)) princeCoatQuantity++;
      if (includesWaistcoat(selection)) waistcoatQuantity++;
    }
    check("pricing stays independent per entry despite sharing one snapshot: princeCoatQuantity = 1", princeCoatQuantity === 1);
    check("pricing stays independent per entry despite sharing one snapshot: waistcoatQuantity = 1", waistcoatQuantity === 1);
  }

  // ── 3. Per-item override display filtering is unaffected by the
  //      shared-block fix — still exactly that entry's own selection. ──
  console.log("3. Per-item override display filtering (Scenario 4 — unaffected by the shared-block change)");
  const overrideSnapshot = await prisma.measurementSnapshot.create({ data: { coatLength: "42.0" } });
  snapshotIds.push(overrideSnapshot.id);
  const overrideOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-VIS-OVERRIDE-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      items: { create: [{ position: 1, measurementMode: "COAT", coatGarmentSelection: "PRINCE_COAT", measurementSnapshot: { connect: { id: overrideSnapshot.id } } }] },
    },
    include: { items: true },
  });
  orderIds.push(overrideOrder.id);
  check("overridden entry's own display selection is exactly PRINCE_COAT, independent of any shared-block union", overrideOrder.items[0].coatGarmentSelection === "PRINCE_COAT");
  check("includesPrinceCoat/includesWaistcoat resolve correctly for this entry", includesPrinceCoat("PRINCE_COAT") === true && includesWaistcoat("PRINCE_COAT") === false);

  // ── 4. Historical NULL selection — still resolves as BOTH for display
  //      filtering (Order Detail / Work Order), exactly as it does for
  //      pricing. ─────────────────────────────────────────────────────
  console.log("4. Historical NULL selection resolves as BOTH for display filtering too");
  const legacyOrder = await prisma.order.create({
    data: {
      orderNumber: `TEST-VIS-LEGACY-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      items: { create: [{ position: 1, measurementMode: "COAT" }] }, // coatGarmentSelection omitted -> NULL
    },
    include: { items: true },
  });
  orderIds.push(legacyOrder.id);
  check("legacy item's coatGarmentSelection is genuinely NULL", legacyOrder.items[0].coatGarmentSelection === null);
  const legacyResolved = legacyOrder.items[0].coatGarmentSelection ?? "BOTH";
  check("legacy item resolves as BOTH -> both Prince Coat and Waistcoat groups would display", includesPrinceCoat(legacyResolved) && includesWaistcoat(legacyResolved));
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
