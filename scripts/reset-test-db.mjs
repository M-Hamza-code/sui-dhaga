// Step 54 — Part 3 ("Clean up test data when appropriate"). Wipes every
// disposable business record from the ISOLATED TEST DATABASE ONLY —
// Customer/Order/OrderItem/MeasurementSnapshot/Measurement — same
// FK-safe order Steps 51/52 already established for the real database's
// own cleanup. Unlike that cleanup, no "keep list" is needed here: by
// definition, nothing in the test database is real data, so an
// unconditional wipe is safe. User/DesignOption/ShopSettings (the
// config setup-test-db.mjs seeds) are left untouched — same rule Steps
// 51/52 followed.
//
// assertTestDatabase() runs first, before any query — this can never run
// against the real development database, deliberately duplicating the
// exact same guard setup-test-db.mjs and test-server.mjs use rather than
// trusting a caller to have checked already.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestDatabase } from "./lib/test-db-guard.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(path.join(PROJECT_ROOT, ".env.test"));
const dbName = assertTestDatabase(process.env.DATABASE_URL);
console.log(`✔ Verified isolated test database: "${dbName}" — safe to reset.`);

// Dynamic import, deliberately after loadEnvFile()/assertTestDatabase()
// — see setup-test-db.mjs's own comment on why a static top-level import
// here would race @prisma/client's own .env auto-loading against ours.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const [orderItems, orders, snapshots, measurements, customers] = await prisma.$transaction([
  prisma.orderItem.deleteMany({}),
  prisma.order.deleteMany({}),
  prisma.measurementSnapshot.deleteMany({}),
  prisma.measurement.deleteMany({}),
  prisma.customer.deleteMany({}),
]);

console.log(
  `✔ Test database reset: removed ${customers.count} customers, ${orders.count} orders, ` +
    `${orderItems.count} order items, ${snapshots.count} measurement snapshots, ${measurements.count} measurements.`
);

await prisma.$disconnect();
