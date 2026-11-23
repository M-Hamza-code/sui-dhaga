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

import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/csv";
import { en } from "@/lib/locale";
import { buildFullBackupContent } from "@/lib/backup-content";

/**
 * Full JSON backup of every persisted business record (Part 2/3). The
 * actual data-building logic lives in backup-content.ts's
 * buildFullBackupContent() now (also reused by the restore engine's own
 * pre-restore safety backup) — this function's own job is strictly the
 * authorization check plus being the Server Action the download button
 * calls.
 */
export async function generateFullBackup(): Promise<string> {
  await requireSession();
  return buildFullBackupContent();
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
