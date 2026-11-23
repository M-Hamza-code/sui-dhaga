import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";

export interface ConsistencyIssue {
  kind: string;
  detail: string;
}

/**
 * Post-restore consistency verification (Requirement 11). Most of what
 * this checks is already enforced by Postgres's own foreign-key
 * constraints at write time (a dangling reference could never have been
 * committed in the first place) — this function re-checks it anyway as
 * independent defense-in-depth, not because the FK constraints are
 * expected to have failed. Never fixes anything itself — it only
 * reports; see restore-actions.ts for what happens with the result.
 */
export async function verifyPostRestoreConsistency(options: { safetyBackupPath?: string | null; expectedRestoreGeneration?: number } = {}): Promise<ConsistencyIssue[]> {
  const issues: ConsistencyIssue[] = [];

  const [orphanOrders, orphanItems, orphanMeasurements, orphanCoatMeasurements, orphanOrderSnapshots, orphanItemSnapshots] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`SELECT o.id FROM orders o LEFT JOIN customers c ON c.id = o."customerId" WHERE c.id IS NULL`,
    prisma.$queryRaw<{ id: string }[]>`SELECT i.id FROM order_items i LEFT JOIN orders o ON o.id = i."orderId" WHERE o.id IS NULL`,
    prisma.$queryRaw<{ id: string }[]>`SELECT m.id FROM measurements m LEFT JOIN customers c ON c.id = m."customerId" WHERE c.id IS NULL`,
    prisma.$queryRaw<{ id: string }[]>`SELECT m.id FROM coat_measurements m LEFT JOIN customers c ON c.id = m."customerId" WHERE c.id IS NULL`,
    prisma.$queryRaw<{
      id: string;
    }[]>`SELECT o.id FROM orders o WHERE o."defaultMeasurementSnapshotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM measurement_snapshots s WHERE s.id = o."defaultMeasurementSnapshotId")`,
    prisma.$queryRaw<{
      id: string;
    }[]>`SELECT i.id FROM order_items i WHERE i."measurementSnapshotId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM measurement_snapshots s WHERE s.id = i."measurementSnapshotId")`,
  ]);

  if (orphanOrders.length > 0) issues.push({ kind: "orphan-order", detail: `${orphanOrders.length} order(s) reference a missing customer.` });
  if (orphanItems.length > 0) issues.push({ kind: "orphan-order-item", detail: `${orphanItems.length} order item(s) reference a missing order.` });
  if (orphanMeasurements.length > 0) issues.push({ kind: "orphan-measurement", detail: `${orphanMeasurements.length} measurement(s) reference a missing customer.` });
  if (orphanCoatMeasurements.length > 0) issues.push({ kind: "orphan-coat-measurement", detail: `${orphanCoatMeasurements.length} coat measurement(s) reference a missing customer.` });
  if (orphanOrderSnapshots.length > 0) issues.push({ kind: "orphan-snapshot-ref", detail: `${orphanOrderSnapshots.length} order(s) reference a missing default measurement snapshot.` });
  if (orphanItemSnapshots.length > 0) issues.push({ kind: "orphan-snapshot-ref", detail: `${orphanItemSnapshots.length} order item(s) reference a missing measurement snapshot.` });

  const duplicateCustomerCodes = await prisma.$queryRaw<{ customerCode: string; n: bigint }[]>`
    SELECT "customerCode", COUNT(*) as n FROM customers GROUP BY "customerCode" HAVING COUNT(*) > 1
  `;
  if (duplicateCustomerCodes.length > 0) {
    issues.push({ kind: "duplicate-customer-code", detail: `${duplicateCustomerCodes.length} customerCode value(s) are duplicated — this should be impossible under the schema's own unique constraint.` });
  }
  const duplicateOrderNumbers = await prisma.$queryRaw<{ orderNumber: string; n: bigint }[]>`
    SELECT "orderNumber", COUNT(*) as n FROM orders GROUP BY "orderNumber" HAVING COUNT(*) > 1
  `;
  if (duplicateOrderNumbers.length > 0) {
    issues.push({ kind: "duplicate-order-number", detail: `${duplicateOrderNumbers.length} orderNumber value(s) are duplicated — this should be impossible under the schema's own unique constraint.` });
  }

  if (typeof options.expectedRestoreGeneration === "number") {
    const settings = await prisma.shopSettings.findUnique({ where: { singleton: true } });
    if (!settings || settings.restoreGeneration !== options.expectedRestoreGeneration) {
      issues.push({ kind: "restore-generation-not-advanced", detail: "ShopSettings.restoreGeneration was not advanced to the expected value after this restore completed." });
    }
  }

  if (options.safetyBackupPath) {
    try {
      const stat = await fs.stat(options.safetyBackupPath);
      if (!stat.isFile() || stat.size === 0) {
        issues.push({ kind: "safety-backup-unreadable", detail: `Safety backup at ${options.safetyBackupPath} exists but is empty or not a regular file.` });
      }
    } catch {
      issues.push({ kind: "safety-backup-missing", detail: `Safety backup at ${options.safetyBackupPath} could not be read after the restore completed.` });
    }
  }

  return issues;
}
