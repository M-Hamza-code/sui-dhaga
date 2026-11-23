// Regression test for three additive upgrades:
//   1. Kameez measurement fields armHole/kohni (Measurement + MeasurementSnapshot).
//   2. The new PANCHA DesignOption category + Order.panchaOptionId relation.
//   3. That everything is purely additive — nothing existing is broken.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrades-measurements-pancha.mjs
// That script loads .env.test and calls assertTestDatabase() BEFORE this
// file's own import of @prisma/client even runs, so by the time this file's
// top-level code executes, DATABASE_URL is already guaranteed to be
// "sui_dhaga_test" — this file also re-asserts it itself, defensively, the
// same way every other data-mutating script in this project does.
//
// Direct-Prisma only (no HTTP) — this exercises the schema/migration/seed
// layer the three upgrades actually changed, without needing to replicate
// this app's Server-Action-based login flow from a plain script.

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
let orderId = null;
let snapshotId = null;

try {
  // ── 1. PANCHA DesignOption seeding ─────────────────────────────────────
  console.log("1. PANCHA design options (seeded by prisma/seed.ts)");
  const panchaOptions = await prisma.designOption.findMany({
    where: { category: "PANCHA" },
    orderBy: { sortOrder: "asc" },
  });
  check("exactly 4 PANCHA options exist", panchaOptions.length === 4);
  check(
    "labels match Sada/Jaali/Kanta/Doora Pancha",
    JSON.stringify(panchaOptions.map((o) => o.label)) ===
      JSON.stringify(["Sada Pancha", "Jaali Pancha", "Kanta Pancha", "Doora Pancha"])
  );
  // The pre-existing numeric Measurement.pancha field and this PANCHA
  // design category must never collapse into the same concept.
  check(
    "PANCHA design codes are PANCHA_* (never collide with Measurement.pancha)",
    panchaOptions.every((o) => o.code.startsWith("PANCHA_"))
  );

  // ── 2. Measurement armHole/kohni round-trip ────────────────────────────
  console.log("2. Measurement.armHole / Measurement.kohni");
  const customer = await prisma.customer.create({
    data: {
      customerCode: `TEST-${suffix}`,
      name: "Regression Test Customer",
      phonePrimary: "03000000000",
    },
  });
  customerId = customer.id;

  const measurement = await prisma.measurement.create({
    data: {
      customerId,
      chest: "42.00",
      armHole: "17.5",
      kohni: "9.37", // deliberately NOT aligned to a 0.5 step — must round-trip exactly
    },
  });
  check("armHole saved and read back exactly", measurement.armHole.toString() === "17.5");
  check("kohni saved and read back exactly, including an unaligned value", measurement.kohni.toString() === "9.37");

  const reread = await prisma.measurement.findUnique({ where: { customerId } });
  check("armHole/kohni survive a fresh read (not just the create() return value)", reread.armHole.toString() === "17.5" && reread.kohni.toString() === "9.37");

  // Existing fields on the same row must be completely unaffected.
  check("pre-existing Measurement.chest is untouched by the new columns", reread.chest.toString() === "42");
  check("pre-existing Measurement.pancha (numeric) is still null, not forced to any value", reread.pancha === null);

  // ── 3. MeasurementSnapshot armHole/kohni round-trip ────────────────────
  console.log("3. MeasurementSnapshot.armHole / MeasurementSnapshot.kohni");
  const snapshot = await prisma.measurementSnapshot.create({
    data: { armHole: "17.5", kohni: "9.37", isBackfilled: false },
  });
  snapshotId = snapshot.id;
  check("snapshot armHole/kohni saved", snapshot.armHole.toString() === "17.5" && snapshot.kohni.toString() === "9.37");

  // ── 4. Order.panchaOptionId relation ────────────────────────────────────
  console.log("4. Order.panchaOptionId / Order.panchaOption relation");
  const chosenPancha = panchaOptions[1]; // "Jaali Pancha"
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      suitType: "SIMPLE",
      cuffType: "NOK_DAR",
      gheraType: "GOL",
      panchaOption: { connect: { id: chosenPancha.id } },
    },
  });
  orderId = order.id;

  const orderWithPancha = await prisma.order.findUnique({
    where: { id: orderId },
    include: { panchaOption: true, pocketOption: true, pattiOption: true },
  });
  check("order.panchaOptionId points at the chosen option", orderWithPancha.panchaOptionId === chosenPancha.id);
  check("order.panchaOption relation resolves to the right label", orderWithPancha.panchaOption?.label === "Jaali Pancha");
  check("existing pocketOption/pattiOption relations are unaffected (both still null, as expected)", orderWithPancha.pocketOption === null && orderWithPancha.pattiOption === null);

  // Order can also be created/updated with NO Pancha selection at all —
  // confirms the FK is genuinely optional, same as Pocket/Patti.
  const orderWithoutPancha = await prisma.order.findUnique({ where: { id: orderId } });
  await prisma.order.update({ where: { id: orderId }, data: { panchaOption: { disconnect: true } } });
  const afterDisconnect = await prisma.order.findUnique({ where: { id: orderId } });
  check("panchaOptionId can be cleared back to null (disconnect)", afterDisconnect.panchaOptionId === null);
  void orderWithoutPancha;
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  // Clean up everything this test created, in FK-safe order, leaving
  // sui_dhaga_test exactly as it was before this run (minus nothing —
  // seeded DesignOption rows are never touched or deleted).
  if (orderId) await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  if (snapshotId) await prisma.measurementSnapshot.delete({ where: { id: snapshotId } }).catch(() => {});
  if (customerId) {
    await prisma.measurement.deleteMany({ where: { customerId } }).catch(() => {});
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
