// Regression test for Issue 2 — "Kohni and Arm Hole disappear on Edit
// Order" — caused by src/lib/measurement-prefill.ts's PrefillMeasurement
// interface and fromSnapshot() never being updated when armHole/kohni
// were added to KAMEEZ_FIELDS (measurement-fields.ts) later. Both
// columns were always saved correctly; only the narrower prefill shape
// used by Edit Order (both the shared default AND every per-suit
// override) and by new-order "prefill from last visit" was dropping
// them.
//
// Duplicates fromSnapshot()'s own (now-fixed) field list inline — same
// reasoning as every other test-upgrade-*.mjs file: this runner executes
// plain .mjs files with plain `node`, no TypeScript loader.
//
// Run ONLY via: node scripts/run-tests.mjs test-upgrade-measurement-prefill-fields.mjs

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

// Mirrors the FIXED measurement-prefill.ts's own fromSnapshot() exactly.
function fromSnapshot(snapshot) {
  return {
    length: snapshot.length,
    shoulder: snapshot.shoulder,
    sleeve: snapshot.sleeve,
    armHole: snapshot.armHole,
    kohni: snapshot.kohni,
    neck: snapshot.neck,
    chest: snapshot.chest,
    waist: snapshot.waist,
    hem: snapshot.hem,
    shalwarLength: snapshot.shalwarLength,
    pancha: snapshot.pancha,
    shalwarPocket: snapshot.shalwarPocket,
    shalwarGheraReady: snapshot.shalwarGheraReady,
    note: snapshot.note,
  };
}

const suffix = Date.now();
let customerId = null;
const orderIds = [];
const snapshotIds = [];

try {
  const customer = await prisma.customer.create({
    data: { customerCode: `TEST-PREFILL-${suffix}`, name: "Measurement Prefill Fields Test Customer", phonePrimary: "03000000009" },
  });
  customerId = customer.id;

  // ── 1. Shared default snapshot — Edit Order's own defaultMeasurement. ─
  console.log("1. Edit Order's shared default measurement — armHole/kohni survive fromSnapshot()");
  const defaultSnapshot = await prisma.measurementSnapshot.create({
    data: { length: "40.0", armHole: "18.5", kohni: "22.0" },
  });
  snapshotIds.push(defaultSnapshot.id);
  {
    const prefill = fromSnapshot(defaultSnapshot);
    check("armHole survives (was silently dropped before the fix)", prefill.armHole !== undefined && Number(prefill.armHole) === 18.5);
    check("kohni survives (was silently dropped before the fix)", prefill.kohni !== undefined && Number(prefill.kohni) === 22.0);
    check("length (an already-working field) is unaffected", Number(prefill.length) === 40.0);
  }

  // ── 2. Per-suit OVERRIDE snapshot — Edit Order's items[].measurement,
  //      a genuinely different code path/snapshot row than the default. ─
  console.log("2. Edit Order's per-suit override measurement — armHole/kohni survive independently");
  const overrideSnapshot = await prisma.measurementSnapshot.create({
    data: { length: "41.0", armHole: "19.0", kohni: "23.5" },
  });
  snapshotIds.push(overrideSnapshot.id);
  {
    const prefill = fromSnapshot(overrideSnapshot);
    check("override entry's own armHole survives", Number(prefill.armHole) === 19.0);
    check("override entry's own kohni survives", Number(prefill.kohni) === 23.5);
    check(
      "override entry's own values are independent of the shared default snapshot's own (18.5/22.0 vs 19.0/23.5)",
      Number(prefill.armHole) !== 18.5 && Number(prefill.kohni) !== 22.0
    );
  }

  // ── 3. New-order prefill — getLatestMeasurementForPrefill's own
  //      "most recent order's snapshot is newer than the live Measurement
  //      row" branch, which is exactly the path that resolves through
  //      fromSnapshot() too (not the "live Measurement row" branch,
  //      which was never affected by this bug — Prisma returns ALL
  //      columns for a plain findUnique, so that branch always worked).
  console.log("3. New-order prefill — the 'latest snapshot is newer than the live Measurement row' branch");
  const oldMeasurement = await prisma.measurement.create({
    data: { customerId, length: "38.0", armHole: "17.0", kohni: "20.0" },
  });
  // A real order's own snapshot, created afterward, is necessarily newer.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const newerSnapshot = await prisma.measurementSnapshot.create({
    data: { length: "39.0", armHole: "18.0", kohni: "21.0" },
  });
  snapshotIds.push(newerSnapshot.id);
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-PREFILL-ORDER-${suffix}`,
      customer: { connect: { id: customerId } },
      orderDate: new Date(),
      totalAmount: "1000.00",
      advanceAmount: "0.00",
      defaultMeasurementSnapshot: { connect: { id: newerSnapshot.id } },
      items: { create: [{ position: 1 }] },
    },
  });
  orderIds.push(order.id);

  const latestOrder = await prisma.order.findFirst({
    where: { customerId, defaultMeasurementSnapshotId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { defaultMeasurementSnapshot: true },
  });
  const snapshotForPrefill = latestOrder?.defaultMeasurementSnapshot ?? null;
  const measurementForPrefill = await prisma.measurement.findUnique({ where: { customerId } });
  check("the order's own snapshot is genuinely newer than the live Measurement row", order.createdAt > oldMeasurement.updatedAt);
  check(
    "getLatestMeasurementForPrefill's own recency rule picks the snapshot (not the live Measurement row) for this case",
    measurementForPrefill.updatedAt <= snapshotForPrefill.createdAt
  );
  {
    const prefill = fromSnapshot(snapshotForPrefill);
    check("new-order prefill's own armHole comes from the newer snapshot (18.0), not the stale live Measurement row (17.0)", Number(prefill.armHole) === 18.0);
    check("new-order prefill's own kohni comes from the newer snapshot (21.0), not the stale live Measurement row (20.0)", Number(prefill.kohni) === 21.0);
  }
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  for (const orderId of orderIds) {
    await prisma.orderItem.deleteMany({ where: { orderId } }).catch(() => {});
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }
  await prisma.measurement.deleteMany({ where: { customerId } }).catch(() => {});
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
