// Backup & Restore — shared types for the restore engine
// (restore-validate.ts / restore-plan.ts / restore-apply.ts /
// restore-consistency.ts / restore-actions.ts).
//
// Scope note (read before extending): this engine restores the 8
// business-data models the existing generateFullBackup() (backup-
// actions.ts) exports — customers, measurements, coatMeasurements,
// orders, orderItems, measurementSnapshots, designOptions,
// shopSettings. `users` IS present in the backup file but is
// deliberately NEVER written back by this engine (see
// restore-plan.ts's own header comment) — the backup's own
// generateFullBackup() never includes passwordHash, so a "restored"
// User row could never actually be logged into; fabricating one would
// be a worse outcome than a nulled-out createdById/updatedById
// reference, which the schema already supports.

/** The exact top-level envelope generateFullBackup() (backup-actions.ts) produces. Only this one, exact shape is accepted — see restore-validate.ts. */
export const SUPPORTED_BACKUP_FORMAT = "sui-dhaga-backup";
export const SUPPORTED_BACKUP_VERSION = 1;

export interface ParsedBackupEnvelope {
  format: string;
  version: number;
  createdAt: string;
  data: {
    users: unknown[];
    customers: unknown[];
    measurements: unknown[];
    coatMeasurements: unknown[];
    orders: unknown[];
    orderItems: unknown[];
    measurementSnapshots: unknown[];
    designOptions: unknown[];
    shopSettings: unknown[];
  };
}

export type RestoreModelName =
  | "customers"
  | "measurements"
  | "coatMeasurements"
  | "orders"
  | "orderItems"
  | "measurementSnapshots"
  | "designOptions"
  | "shopSettings";

export const RESTORE_MODEL_NAMES: readonly RestoreModelName[] = [
  "customers",
  "measurements",
  "coatMeasurements",
  "orders",
  "orderItems",
  "measurementSnapshots",
  "designOptions",
  "shopSettings",
];

/** One record this restore plan decided is safe to create outright (Operation A) — never an overwrite, by construction (see restore-plan.ts). */
export interface ImportCandidate {
  model: RestoreModelName;
  /** Human-readable identity for the summary/UI (e.g. "SD-000124 — Imran Khan", "Order ORD-000045 position 2"). */
  label: string;
  data: Record<string, unknown>;
}

/** One record that exists in BOTH the backup and the target with genuinely different content — needs an explicit admin decision (Operation B). Never auto-applied. */
export interface ConflictCandidate {
  model: RestoreModelName;
  /** The record's own natural key for re-identifying it later (e.g. Customer.id, "orderId:position" for an OrderItem). Opaque to the UI — just round-tripped back into resolveConflict(). */
  key: string;
  label: string;
  /** Only the fields that actually differ, each with both values, for display — never the full row (keeps the admin's attention on what's actually different). */
  diff: { field: string; current: unknown; backup: unknown }[];
  backupData: Record<string, unknown>;
  /** The target row's own current version token (Customer/Order: updatedAt ISO string) — required so applying "use backup" is itself an atomic conditional update, never a blind overwrite racing a concurrent edit. */
  currentVersion: string;
  /**
   * DesignOption only (empty object for every other model, which uses
   * `currentVersion` instead). This model has no `updatedAt` column at
   * all, so there is no single version token to put in an atomic
   * `updateMany`'s WHERE clause — instead, the record's own id plus
   * every relevant field's CURRENT value (captured here, at plan-build
   * time, regardless of whether that specific field was the one that
   * differed) goes into the WHERE clause directly, so the conditional
   * update's `count` can only be 1 if nothing relevant has changed
   * since this plan was built, and 0 otherwise — restore-apply.ts's
   * applyConflictResolution() reports that as "stale-plan", exactly
   * like every other model's `updatedAt`-mismatch case.
   */
  currentValues: Record<string, unknown>;
}

/** A record the plan refused to touch at all — a genuine identity ambiguity (e.g. two different ids sharing the same customerCode), or a dependency that was itself quarantined. Never imported, never offered for conflict resolution. */
export interface QuarantinedRecord {
  model: RestoreModelName;
  label: string;
  reason: string;
}

export interface RestorePlanSummary {
  importCount: number;
  conflictCount: number;
  quarantineCount: number;
  perModelCounts: Record<RestoreModelName, { imported: number; conflicts: number; quarantined: number; alreadyConsistent: number }>;
  nulledCreatorReferences: number;
}

export interface RestorePlan {
  restoreAttemptId: string;
  imports: ImportCandidate[];
  conflicts: ConflictCandidate[];
  quarantined: QuarantinedRecord[];
  summary: RestorePlanSummary;
  /** category+code -> the id this restore will actually use for that DesignOption (its own backup id, or an existing target row's id if one already matches by the natural key) — needed so Order/OrderItem's own pocket/patti/pancha references resolve to the right row regardless of which id "won". */
  designOptionIdRemap: Record<string, string>;
}

// ── restore-actions.ts's own result shapes (kept here, not in that
// "use server" file, per this codebase's own established convention
// that such a file's exports must all be async Server Actions) ───────

export interface PlanRestoreResult {
  ok: boolean;
  restoreAttemptId?: string;
  error?: string;
  backupCreatedAt?: string;
  recordCounts?: Record<RestoreModelName, number>;
  checksum?: string;
  importCount?: number;
  conflicts?: ConflictCandidate[];
  quarantined?: QuarantinedRecord[];
  nulledCreatorReferences?: number;
}

export interface ApplyRestoreResult {
  ok: boolean;
  error?: string;
  importedCounts?: Record<RestoreModelName, number>;
  appliedConflicts?: number;
  skippedConflicts?: number;
  failedConflicts?: { label: string; reason: string }[];
  consistencyIssues?: { kind: string; detail: string }[];
  safetyBackupPath?: string;
}

export type FieldKind = "decimal" | "date" | "str" | "bool" | "int";

/** Per-model field-kind lookup for every field that can appear in a ConflictCandidate's `diff` — restore-apply.ts uses this to convert a diff entry's already-normalized `backup` value back into what Prisma's update `data` expects, without duplicating restore-plan.ts's own field lists by hand. */
export const CONFLICT_FIELD_KINDS: Record<RestoreModelName, Record<string, FieldKind>> = {
  customers: { name: "str", phonePrimary: "str", phoneSecondary: "str", address: "str", deletedAt: "date" },
  measurements: {
    length: "decimal",
    shoulder: "decimal",
    sleeve: "decimal",
    neck: "decimal",
    chest: "decimal",
    waist: "decimal",
    hem: "decimal",
    armHole: "decimal",
    kohni: "decimal",
    shalwarLength: "decimal",
    pancha: "decimal",
    shalwarGheraReady: "decimal",
    shalwarPocket: "bool",
    note: "str",
  },
  coatMeasurements: {
    coatLength: "decimal",
    coatShoulder: "decimal",
    coatChest: "decimal",
    coatWaist: "decimal",
    coatHipSeat: "decimal",
    coatSleeve: "decimal",
    coatArmHole: "decimal",
    coatBicep: "decimal",
    coatCuff: "decimal",
    coatNeck: "decimal",
    coatBackWidth: "decimal",
    coatFrontLength: "decimal",
    waistcoatLength: "decimal",
    waistcoatShoulder: "decimal",
    waistcoatChest: "decimal",
    waistcoatWaist: "decimal",
    waistcoatHipSeat: "decimal",
    waistcoatArmHole: "decimal",
    waistcoatNeck: "decimal",
    waistcoatBackWidth: "decimal",
    waistcoatFrontLength: "decimal",
    note: "str",
  },
  orders: {
    orderDate: "date",
    deliveryDate: "date",
    measurementMode: "str",
    suitType: "str",
    collarType: "str",
    bainType: "str",
    cuffType: "str",
    gheraType: "str",
    totalAmount: "decimal",
    advanceAmount: "decimal",
    balanceAmount: "decimal",
    princeCoatUnitPrice: "decimal",
    waistcoatUnitPrice: "decimal",
    status: "str",
    note: "str",
  },
  orderItems: { suitType: "str", collarType: "str", bainType: "str", cuffType: "str", gheraType: "str", measurementMode: "str", coatGarmentSelection: "str" },
  measurementSnapshots: {},
  designOptions: { label: "str", sortOrder: "int", isActive: "bool" },
  shopSettings: { name: "str", phone: "str", address: "str", tagline: "str", defaultAdvancePercent: "decimal", defaultPrices: "str" },
};
