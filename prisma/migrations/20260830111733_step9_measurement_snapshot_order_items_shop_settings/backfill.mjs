// Step 9 one-time data backfill — run ONCE, immediately after
// `prisma migrate deploy` applied this migration's migration.sql, against
// the pre-existing Steps 1–8 data. Kept here (not deleted) purely as a
// record of exactly what was done and why; it is idempotent (safe to
// re-run — every write is guarded to skip rows already migrated) but
// there should be no remaining rows left for it to touch on this
// database. Run with: node_modules/.bin/tsx prisma/migrations/<this
// folder>/backfill.mjs
//
// What it did, in order:
//   1. Migrated every existing Order.status of PENDING to NEW (Postgres
//      enum values can't be dropped, so PENDING stays defined but unused
//      going forward). DELIVERED rows were left untouched.
//   2. Gave every existing Order exactly one OrderItem (position 1), so
//      every historical single-suit order is a valid instance of the new
//      multi-suit model.
//   3. For each order, best-effort reconstructed a default
//      MeasurementSnapshot by copying the customer's CURRENT Measurement
//      row at backfill time (flagged isBackfilled: true — this is an
//      approximation, not a guaranteed record of the values actually used
//      when the order was originally created, since no snapshot existed
//      before this migration). Orders for a customer with no Measurement
//      on file were left with no default snapshot — that is valid, not
//      an error.
//   4. Seeded exactly one ShopSettings row (upsert on the `singleton`
//      unique key) with clearly-placeholder values — the real shop
//      details are entered later, through the Settings screen.

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const statusResult = await prisma.order.updateMany({
    where: { status: "PENDING" },
    data: { status: "NEW" },
  });
  console.log(`[status] Migrated ${statusResult.count} PENDING order(s) to NEW`);

  const deliveredCount = await prisma.order.count({ where: { status: "DELIVERED" } });
  console.log(`[status] DELIVERED order(s) left untouched: ${deliveredCount}`);

  const orders = await prisma.order.findMany({
    where: { items: { none: {} } },
    select: { id: true, orderNumber: true, customerId: true },
  });
  console.log(`[backfill] ${orders.length} order(s) need OrderItem backfill`);

  let withSnapshot = 0;
  let withoutSnapshot = 0;

  for (const order of orders) {
    const measurement = await prisma.measurement.findUnique({ where: { customerId: order.customerId } });

    let snapshotId = null;
    if (measurement) {
      const snapshot = await prisma.measurementSnapshot.create({
        data: {
          length: measurement.length,
          shoulder: measurement.shoulder,
          sleeve: measurement.sleeve,
          neck: measurement.neck,
          chest: measurement.chest,
          waist: measurement.waist,
          hem: measurement.hem,
          shalwarLength: measurement.shalwarLength,
          pancha: measurement.pancha,
          shalwarPocket: measurement.shalwarPocket,
          shalwarGheraReady: measurement.shalwarGheraReady,
          note: measurement.note,
          isBackfilled: true,
        },
        select: { id: true },
      });
      snapshotId = snapshot.id;
      withSnapshot++;
    } else {
      withoutSnapshot++;
    }

    await prisma.$transaction([
      ...(snapshotId
        ? [prisma.order.update({ where: { id: order.id }, data: { defaultMeasurementSnapshotId: snapshotId } })]
        : []),
      prisma.orderItem.create({
        data: { orderId: order.id, position: 1 },
      }),
    ]);
    console.log(`[backfill] ${order.orderNumber}: 1 OrderItem created, snapshot=${snapshotId ? "yes" : "none"}`);
  }

  console.log(`[backfill] orders with a reconstructed snapshot: ${withSnapshot}`);
  console.log(`[backfill] orders without a snapshot (no Measurement on file): ${withoutSnapshot}`);

  const settings = await prisma.shopSettings.upsert({
    where: { singleton: true },
    update: {},
    create: {
      singleton: true,
      name: "Sui Dhaga",
      phone: "",
      address: null,
      tagline: null,
      defaultPrices: {},
      defaultAdvancePercent: null,
    },
  });
  console.log(`[settings] ShopSettings row ready: ${settings.id}`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
