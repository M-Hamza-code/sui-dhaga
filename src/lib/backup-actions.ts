"use server";

// Server Actions for manual backup and data export (Step 19). Every
// action here is strictly read-only — none of them ever calls
// prisma.<model>.create/update/delete — and, like every mutating action
// elsewhere in this app, starts with requireSession() so the existing
// authentication architecture is the only thing guarding this data, not
// a second bespoke check.
//
// Each action returns its generated file content as a plain string
// (JSON or CSV text) rather than raw Prisma rows. Prisma's Decimal and
// Date field values cannot safely cross a Server Action's own
// serialization boundary as live objects — turning everything into text
// here, server-side, sidesteps that entirely and is also just what a
// downloadable file actually is: text. The client-side download trigger
// (backup-download.ts) never touches the database at all.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { en } from "@/lib/locale";

const BACKUP_FORMAT = "sui-dhaga-backup";
const BACKUP_VERSION = 1;

/**
 * Full JSON backup of every persisted business record (Part 2/3). Covers
 * every model in prisma/schema.prisma except the parts of User that are
 * authentication secrets — see the explicit `select` below, which is the
 * one and only place passwordHash could leak from and deliberately never
 * does.
 */
export async function generateFullBackup(): Promise<string> {
  await requireSession();

  const [users, customers, measurements, orders, orderItems, measurementSnapshots, designOptions, shopSettings] =
    await Promise.all([
      // Never passwordHash — id/name/email/createdAt only, kept solely so
      // the *ById relations below stay meaningful (who created/updated
      // what), not as an account list.
      prisma.user.findMany({ select: { id: true, name: true, email: true, createdAt: true } }),
      prisma.customer.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.measurement.findMany(),
      prisma.order.findMany({ orderBy: { orderNumber: "asc" } }),
      prisma.orderItem.findMany({ orderBy: [{ orderId: "asc" }, { position: "asc" }] }),
      prisma.measurementSnapshot.findMany(),
      prisma.designOption.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
      prisma.shopSettings.findMany(),
    ]);

  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      // Every record keeps its real id and every foreign key exactly as
      // stored (customerId, orderId, createdById, defaultMeasurementSnapshotId,
      // measurementSnapshotId, pocketOptionId, pattiOptionId, ...) — a
      // restore/import step (not part of Step 19) could reconstruct every
      // relationship from this alone, nothing is flattened away.
      users,
      customers,
      measurements,
      orders,
      orderItems,
      measurementSnapshots,
      designOptions,
      shopSettings,
    },
  };

  // JSON.stringify already calls Decimal's toJSON()/toString() and
  // Date's toJSON() (-> ISO string) for every nested value, so every
  // amount/measurement value and timestamp comes out as a plain,
  // human-readable string/number — never an opaque object.
  return JSON.stringify(backup, null, 2);
}

/** Every Customer record — active and soft-deleted alike; see the Step 19 report for why. */
export async function generateCustomersCsv(): Promise<string> {
  await requireSession();

  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "asc" } });

  const header = ["Customer Code", "Name", "Primary Phone", "Secondary Phone", "Address", "Created At", "Deleted"];
  const rows = customers.map((c) => [
    c.customerCode,
    c.name,
    c.phonePrimary,
    c.phoneSecondary ?? "",
    c.address ?? "",
    c.createdAt.toISOString(),
    c.deletedAt ? "Yes" : "No",
  ]);

  return toCsv(header, rows);
}

/** Every Order record, including orders belonging to a since-soft-deleted customer. */
export async function generateOrdersCsv(): Promise<string> {
  await requireSession();

  const orders = await prisma.order.findMany({
    orderBy: { orderNumber: "asc" },
    include: { customer: true, _count: { select: { items: true } } },
  });

  const header = [
    "Order Number",
    "Customer Name",
    "Order Date",
    "Delivery Date",
    "Status",
    "Suits",
    "Total",
    "Advance",
    "Balance",
  ];
  const rows = orders.map((o) => [
    // The raw stored orderNumber ("ORD-000012"), not the bare on-screen
    // display number — this is a data-portability export, not an S1-S6
    // UI screen, and the full stored identifier is the unambiguous one
    // for a spreadsheet meant for reconciliation/lookup.
    o.orderNumber,
    o.customer.name,
    o.orderDate.toISOString().slice(0, 10),
    o.deliveryDate ? o.deliveryDate.toISOString().slice(0, 10) : "",
    en.status[o.status],
    // Same historical fallback used everywhere else an order's suit
    // count is shown (customer profile, Order Board): a pre-Step-14
    // order has zero OrderItem rows but is still at least one suit.
    Math.max(1, o._count.items),
    o.totalAmount.toString(),
    o.advanceAmount.toString(),
    o.balanceAmount.toString(),
  ]);

  return toCsv(header, rows);
}
