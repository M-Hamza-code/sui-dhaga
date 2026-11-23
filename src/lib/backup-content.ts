import { prisma } from "@/lib/prisma";

// Plain module, NOT "use server" — deliberately. Every export of a
// "use server" file becomes a client-callable Server Action regardless
// of what it does internally; buildFullBackupContent() below has no
// authorization check of its own (by design — see its own comment), so
// it must never live in a "use server" file or it would become a
// reachable, unauthenticated full-database dump. backup-actions.ts's
// generateFullBackup() is the one place that adds the session check
// before calling this.

const BACKUP_FORMAT = "sui-dhaga-backup";
const BACKUP_VERSION = 1;

/**
 * The actual backup content — pure data generation, no session/
 * authorization check of its own. Safe to call from any already-
 * authorized trusted server-side context, including one with no HTTP
 * request scope at all (restore-apply.ts's takeSafetyBackup(), which
 * runs as part of an already-admin-authorized restore and has no
 * `next/headers` cookies() context available to it — calling through
 * requireSession() there would throw "cookies() called outside a
 * request scope", not a security hole, but a context mismatch).
 * generateFullBackup() (backup-actions.ts) is the only path reachable
 * from the browser, and it is what adds the check this function omits.
 */
export async function buildFullBackupContent(): Promise<string> {
  const [users, customers, measurements, coatMeasurements, orders, orderItems, measurementSnapshots, designOptions, shopSettings] =
    await Promise.all([
      // Never passwordHash — id/name/email/createdAt only, kept solely so
      // the *ById relations below stay meaningful (who created/updated
      // what), not as an account list.
      prisma.user.findMany({ select: { id: true, name: true, email: true, createdAt: true } }),
      prisma.customer.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.measurement.findMany(),
      prisma.coatMeasurement.findMany(),
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
      // measurementSnapshotId, pocketOptionId, pattiOptionId, ...) — the
      // restore engine (src/lib/restore/) reconstructs every
      // relationship from this alone, nothing is flattened away.
      users,
      customers,
      measurements,
      coatMeasurements,
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
