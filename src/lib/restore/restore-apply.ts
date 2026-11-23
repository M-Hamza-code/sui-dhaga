import { promises as fs } from "fs";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildFullBackupContent } from "@/lib/backup-content";
import { CONFLICT_FIELD_KINDS, type ConflictCandidate, type ImportCandidate, type RestoreModelName } from "./restore-types";

// Backup & Restore — the only file in this engine that writes to the
// database. restore-plan.ts decides WHAT to do; this file is purely
// mechanical about HOW, so every write stays auditable in one place.

const SAFETY_BACKUP_DIR = path.join(process.cwd(), "var", "restore-safety-backups");

/**
 * Pre-restore safety backup (Requirement 7) — a full backup taken
 * BEFORE any Operation A/B write of this attempt, so a bad restore can
 * always be manually recovered from by re-uploading this same file.
 * Reuses buildFullBackupContent() verbatim (the same pure data-building
 * logic generateFullBackup()/backup-actions.ts calls after its own
 * session check) — not a second, drifting backup implementation. Calls
 * the pure, session-free variant specifically because this runs as part
 * of an already-admin-authorized restore (requireAdminSession() already
 * ran in restore-actions.ts before this), not from an HTTP request
 * context of its own — going through generateFullBackup()'s own
 * requireSession() would throw ("cookies() called outside a request
 * scope") in exactly the context this function is meant to run in.
 *
 * Written atomically: to a `.tmp` file in the SAME directory as the
 * final path, then renamed into place. A rename within one directory on
 * the same volume is atomic on both POSIX and NTFS, so a crash between
 * the write and the rename leaves either nothing (the .tmp file,
 * ignored by every reader) or the complete, final file — never a
 * half-written one masquerading as complete.
 *
 * Durability caveat, stated plainly rather than silently assumed: this
 * writes to the LOCAL filesystem of whichever machine runs this process
 * — correct and sufficient for this app's own established "single shop,
 * single machine" deployment model (same assumption the rest of this
 * codebase has made since Step 1), but NOT durable across an ephemeral
 * container, a ephemeral/serverless deployment, or a multi-instance
 * deployment without a shared volume. See the implementation report's
 * own "deployment blockers" section — this is flagged there, not hidden
 * here.
 */
export async function takeSafetyBackup(restoreAttemptId: string): Promise<string> {
  const content = await buildFullBackupContent();
  await fs.mkdir(SAFETY_BACKUP_DIR, { recursive: true });
  const finalPath = path.join(SAFETY_BACKUP_DIR, `${restoreAttemptId}.json`);
  const tmpPath = `${finalPath}.tmp`;
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, finalPath);
  return finalPath;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  return new Date(v as string);
}

/** Converts one ImportCandidate's plain data bag into the exact Prisma create call for its model. Every date-like field is explicitly converted (never left as a plain string for Prisma to maybe-coerce) — this is also where each model's original createdAt/updatedAt from the backup is explicitly preserved, since passing a value at create time overrides @default(now())/@updatedAt (same create-vs-update override semantic already relied on elsewhere in this codebase — see order-build.ts). */
async function createOne(tx: Prisma.TransactionClient, candidate: ImportCandidate): Promise<void> {
  const d = candidate.data;
  switch (candidate.model) {
    case "customers":
      await tx.customer.create({
        data: {
          id: d.id as string,
          customerCode: d.customerCode as string,
          name: d.name as string,
          phonePrimary: d.phonePrimary as string,
          phoneSecondary: (d.phoneSecondary as string | null) ?? null,
          address: (d.address as string | null) ?? null,
          deletedAt: toDate(d.deletedAt),
          createdById: (d.createdById as string | null) ?? null,
          createdAt: toDate(d.createdAt) ?? undefined,
          updatedAt: toDate(d.updatedAt) ?? undefined,
        },
      });
      return;
    case "measurements":
      await tx.measurement.create({
        data: {
          id: d.id as string,
          customerId: d.customerId as string,
          length: d.length as string | null,
          shoulder: d.shoulder as string | null,
          sleeve: d.sleeve as string | null,
          neck: d.neck as string | null,
          chest: d.chest as string | null,
          waist: d.waist as string | null,
          hem: d.hem as string | null,
          armHole: d.armHole as string | null,
          kohni: d.kohni as string | null,
          shalwarLength: d.shalwarLength as string | null,
          pancha: d.pancha as string | null,
          shalwarPocket: (d.shalwarPocket as boolean | null) ?? null,
          shalwarGheraReady: d.shalwarGheraReady as string | null,
          note: (d.note as string | null) ?? null,
          updatedById: (d.updatedById as string | null) ?? null,
          updatedAt: toDate(d.updatedAt) ?? undefined,
        },
      });
      return;
    case "coatMeasurements":
      await tx.coatMeasurement.create({
        data: {
          id: d.id as string,
          customerId: d.customerId as string,
          coatLength: d.coatLength as string | null,
          coatShoulder: d.coatShoulder as string | null,
          coatChest: d.coatChest as string | null,
          coatWaist: d.coatWaist as string | null,
          coatHipSeat: d.coatHipSeat as string | null,
          coatSleeve: d.coatSleeve as string | null,
          coatArmHole: d.coatArmHole as string | null,
          coatBicep: d.coatBicep as string | null,
          coatCuff: d.coatCuff as string | null,
          coatNeck: d.coatNeck as string | null,
          coatBackWidth: d.coatBackWidth as string | null,
          coatFrontLength: d.coatFrontLength as string | null,
          waistcoatLength: d.waistcoatLength as string | null,
          waistcoatShoulder: d.waistcoatShoulder as string | null,
          waistcoatChest: d.waistcoatChest as string | null,
          waistcoatWaist: d.waistcoatWaist as string | null,
          waistcoatHipSeat: d.waistcoatHipSeat as string | null,
          waistcoatArmHole: d.waistcoatArmHole as string | null,
          waistcoatNeck: d.waistcoatNeck as string | null,
          waistcoatBackWidth: d.waistcoatBackWidth as string | null,
          waistcoatFrontLength: d.waistcoatFrontLength as string | null,
          note: (d.note as string | null) ?? null,
          updatedById: (d.updatedById as string | null) ?? null,
          updatedAt: toDate(d.updatedAt) ?? undefined,
        },
      });
      return;
    case "measurementSnapshots":
      await tx.measurementSnapshot.create({
        data: {
          id: d.id as string,
          length: d.length as string | null,
          shoulder: d.shoulder as string | null,
          sleeve: d.sleeve as string | null,
          neck: d.neck as string | null,
          chest: d.chest as string | null,
          waist: d.waist as string | null,
          hem: d.hem as string | null,
          armHole: d.armHole as string | null,
          kohni: d.kohni as string | null,
          shalwarLength: d.shalwarLength as string | null,
          pancha: d.pancha as string | null,
          shalwarPocket: (d.shalwarPocket as boolean | null) ?? null,
          shalwarGheraReady: d.shalwarGheraReady as string | null,
          coatLength: d.coatLength as string | null,
          coatShoulder: d.coatShoulder as string | null,
          coatChest: d.coatChest as string | null,
          coatWaist: d.coatWaist as string | null,
          coatHipSeat: d.coatHipSeat as string | null,
          coatSleeve: d.coatSleeve as string | null,
          coatArmHole: d.coatArmHole as string | null,
          coatBicep: d.coatBicep as string | null,
          coatCuff: d.coatCuff as string | null,
          coatNeck: d.coatNeck as string | null,
          coatBackWidth: d.coatBackWidth as string | null,
          coatFrontLength: d.coatFrontLength as string | null,
          waistcoatLength: d.waistcoatLength as string | null,
          waistcoatShoulder: d.waistcoatShoulder as string | null,
          waistcoatChest: d.waistcoatChest as string | null,
          waistcoatWaist: d.waistcoatWaist as string | null,
          waistcoatHipSeat: d.waistcoatHipSeat as string | null,
          waistcoatArmHole: d.waistcoatArmHole as string | null,
          waistcoatNeck: d.waistcoatNeck as string | null,
          waistcoatBackWidth: d.waistcoatBackWidth as string | null,
          waistcoatFrontLength: d.waistcoatFrontLength as string | null,
          note: (d.note as string | null) ?? null,
          isBackfilled: (d.isBackfilled as boolean) ?? false,
          createdAt: toDate(d.createdAt) ?? undefined,
        },
      });
      return;
    case "orders":
      await tx.order.create({
        data: {
          id: d.id as string,
          orderNumber: d.orderNumber as string,
          customerId: d.customerId as string,
          orderDate: toDate(d.orderDate) as Date,
          deliveryDate: toDate(d.deliveryDate),
          measurementMode: d.measurementMode as never,
          suitType: d.suitType as never,
          collarType: d.collarType as never,
          bainType: d.bainType as never,
          cuffType: d.cuffType as never,
          gheraType: d.gheraType as never,
          pocketOptionId: (d.pocketOptionId as string | null) ?? null,
          pattiOptionId: (d.pattiOptionId as string | null) ?? null,
          panchaOptionId: (d.panchaOptionId as string | null) ?? null,
          defaultMeasurementSnapshotId: (d.defaultMeasurementSnapshotId as string | null) ?? null,
          totalAmount: d.totalAmount as string,
          advanceAmount: d.advanceAmount as string,
          balanceAmount: d.balanceAmount as string,
          princeCoatUnitPrice: d.princeCoatUnitPrice as string | null,
          waistcoatUnitPrice: d.waistcoatUnitPrice as string | null,
          status: d.status as never,
          createdById: (d.createdById as string | null) ?? null,
          note: (d.note as string | null) ?? null,
          createdAt: toDate(d.createdAt) ?? undefined,
          updatedAt: toDate(d.updatedAt) ?? undefined,
        },
      });
      return;
    case "orderItems":
      await tx.orderItem.create({
        data: {
          id: d.id as string,
          orderId: d.orderId as string,
          position: d.position as number,
          measurementSnapshotId: (d.measurementSnapshotId as string | null) ?? null,
          suitType: d.suitType as never,
          collarType: d.collarType as never,
          bainType: d.bainType as never,
          cuffType: d.cuffType as never,
          gheraType: d.gheraType as never,
          measurementMode: d.measurementMode as never,
          coatGarmentSelection: d.coatGarmentSelection as never,
          pocketOptionId: (d.pocketOptionId as string | null) ?? null,
          createdAt: toDate(d.createdAt) ?? undefined,
          updatedAt: toDate(d.updatedAt) ?? undefined,
        },
      });
      return;
    case "designOptions":
      await tx.designOption.create({
        data: {
          id: d.id as string,
          category: d.category as never,
          code: d.code as string,
          label: d.label as string,
          sortOrder: d.sortOrder as number,
          isActive: d.isActive as boolean,
        },
      });
      return;
    case "shopSettings":
      await tx.shopSettings.create({
        data: {
          singleton: true,
          name: d.name as string,
          phone: d.phone as string,
          address: (d.address as string | null) ?? null,
          tagline: (d.tagline as string | null) ?? null,
          defaultPrices: (d.defaultPrices as object) ?? {},
          defaultAdvancePercent: d.defaultAdvancePercent as string | null,
        },
      });
      return;
  }
}

/** FK-safe creation order — mirrors restore-plan.ts's own processing order exactly (Customer must exist before Measurement/CoatMeasurement/Order; MeasurementSnapshot before Order/OrderItem reference it; Order before OrderItem). */
const IMPORT_ORDER: RestoreModelName[] = [
  "designOptions",
  "shopSettings",
  "customers",
  "measurements",
  "coatMeasurements",
  "measurementSnapshots",
  "orders",
  "orderItems",
];

export interface OperationAResult {
  created: Record<RestoreModelName, number>;
}

/**
 * Operation A — import every record the plan already decided is
 * missing-and-unambiguous. One single transaction for the entire import
 * pass: either every record in the plan is created, or (on any error —
 * a constraint violation the plan itself didn't anticipate, a crash,
 * anything) none of them are. Postgres's own transaction rollback is
 * what provides the crash-recovery guarantee here — nothing bespoke is
 * needed on top of it (a crash before COMMIT leaves the database
 * exactly as it was before this function was ever called).
 */
export async function applyOperationA(imports: ImportCandidate[]): Promise<OperationAResult> {
  const created: Record<RestoreModelName, number> = {
    customers: 0,
    measurements: 0,
    coatMeasurements: 0,
    orders: 0,
    orderItems: 0,
    measurementSnapshots: 0,
    designOptions: 0,
    shopSettings: 0,
  };
  const byModel = new Map<RestoreModelName, ImportCandidate[]>();
  for (const model of IMPORT_ORDER) byModel.set(model, []);
  for (const candidate of imports) byModel.get(candidate.model)!.push(candidate);

  await prisma.$transaction(
    async (tx) => {
      for (const model of IMPORT_ORDER) {
        for (const candidate of byModel.get(model)!) {
          await createOne(tx, candidate);
          created[model]++;
        }
      }
    },
    { timeout: 120_000 }
  );

  return { created };
}

export type ConflictDecision = "keep-current" | "apply-backup";

export type ApplyConflictResult = { ok: true } | { ok: false; reason: "stale-plan" | "not-found" };

/**
 * Operation B for exactly ONE record. "keep-current" is a pure no-op by
 * construction — there is no write path for it at all, so it is
 * impossible for this function to accidentally apply a backup value the
 * admin didn't explicitly ask for. "apply-backup" writes ONLY the
 * fields that were actually flagged as different (conflict.diff) —
 * never the full raw backup row — via an atomic conditional update
 * guarded by the record's own version token, except DesignOption (no
 * updatedAt column — see restore-plan.ts's header comment), which uses
 * a plain update instead.
 */
export async function applyConflictResolution(conflict: ConflictCandidate, decision: ConflictDecision): Promise<ApplyConflictResult> {
  if (decision === "keep-current") {
    return { ok: true };
  }

  const kinds = CONFLICT_FIELD_KINDS[conflict.model];
  const data: Record<string, unknown> = {};
  for (const d of conflict.diff) {
    const kind = kinds[d.field];
    if (kind === "date") {
      data[d.field] = d.backup === null ? null : new Date(d.backup as string);
    } else {
      data[d.field] = d.backup;
    }
  }

  switch (conflict.model) {
    case "customers": {
      const result = await prisma.customer.updateMany({ where: { id: conflict.key, updatedAt: new Date(conflict.currentVersion) }, data });
      return result.count === 1 ? { ok: true } : { ok: false, reason: "stale-plan" };
    }
    case "orders": {
      const result = await prisma.order.updateMany({ where: { id: conflict.key, updatedAt: new Date(conflict.currentVersion) }, data });
      return result.count === 1 ? { ok: true } : { ok: false, reason: "stale-plan" };
    }
    case "measurements": {
      const result = await prisma.measurement.updateMany({ where: { customerId: conflict.key, updatedAt: new Date(conflict.currentVersion) }, data });
      return result.count === 1 ? { ok: true } : { ok: false, reason: "stale-plan" };
    }
    case "coatMeasurements": {
      const result = await prisma.coatMeasurement.updateMany({ where: { customerId: conflict.key, updatedAt: new Date(conflict.currentVersion) }, data });
      return result.count === 1 ? { ok: true } : { ok: false, reason: "stale-plan" };
    }
    case "orderItems": {
      const [orderId, positionStr] = conflict.key.split(":");
      const result = await prisma.orderItem.updateMany({
        where: { orderId, position: Number(positionStr), updatedAt: new Date(conflict.currentVersion) },
        data,
      });
      return result.count === 1 ? { ok: true } : { ok: false, reason: "stale-plan" };
    }
    case "shopSettings": {
      const result = await prisma.shopSettings.updateMany({ where: { singleton: true, updatedAt: new Date(conflict.currentVersion) }, data });
      return result.count === 1 ? { ok: true } : { ok: false, reason: "stale-plan" };
    }
    case "designOptions": {
      // No updatedAt column on this model, so there is no single version
      // token for the WHERE clause — instead, the row's own id PLUS
      // every relevant field's plan-time current value (conflict.currentValues,
      // captured in restore-plan.ts regardless of which field actually
      // differed) go into one atomic conditional updateMany. This is a
      // genuine compare-and-swap, not a transaction wrapping a separate
      // read-then-write: the single UPDATE statement itself only matches
      // a row whose content is STILL exactly what the plan saw, so
      // `count` can only be 1 if nothing relevant changed since the plan
      // was built — identical safety guarantee to every other model's
      // `updatedAt`-guarded updateMany above, just keyed on content
      // instead of a timestamp.
      const [category, code] = conflict.key.split(":");
      const cv = conflict.currentValues;
      if (typeof cv.id !== "string") {
        // The plan never actually reached this model's branch with a
        // resolved id (e.g. a hand-built/stale ConflictCandidate) —
        // fail closed rather than attempt an unguarded update. No
        // preliminary read here either, same reasoning as below: this
        // is a pure input-shape check, not a read-then-write step.
        return { ok: false, reason: "not-found" };
      }

      const result = await prisma.designOption.updateMany({
        where: {
          id: cv.id,
          category: category as never,
          code,
          label: cv.label as string,
          sortOrder: cv.sortOrder as number,
          isActive: cv.isActive as boolean,
        },
        data,
      });
      return result.count === 1 ? { ok: true } : { ok: false, reason: "stale-plan" };
    }
    default:
      return { ok: false, reason: "not-found" };
  }
}
