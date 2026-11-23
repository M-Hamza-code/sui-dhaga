import { prisma } from "@/lib/prisma";
import type {
  ConflictCandidate,
  ImportCandidate,
  ParsedBackupEnvelope,
  QuarantinedRecord,
  RestoreModelName,
  RestorePlan,
} from "./restore-types";

// Backup & Restore — the identity-resolution and diff-building engine.
// Builds a plan; NEVER writes to the database itself (see
// restore-apply.ts for that). Every record this plan touches ends up in
// exactly one of three buckets:
//   - imports: safe to create outright (Operation A) — the record is
//     missing from this database and its identity is unambiguous.
//   - conflicts: exists in both places with genuinely different content
//     — needs an explicit admin decision (Operation B), never auto-
//     applied, defaults to "keep current" by construction (nothing in
//     this file ever writes a conflict's backup value anywhere).
//   - quarantined: never touched at all — a genuine identity ambiguity
//     (the same id already means something else here, or the same
//     business key already belongs to a different id) or a dependency
//     that was itself quarantined/missing (propagated down the FK
//     chain: Customer -> Measurement/CoatMeasurement/Order -> OrderItem).
//
// Processed in strict FK dependency order: DesignOption, ShopSettings,
// Customer, Measurement, CoatMeasurement, MeasurementSnapshot, Order,
// OrderItem — so every later model can already see what every earlier
// one decided (imported, quarantined, or already-consistent) before
// making its own decision.
//
// `users` from the backup is read ONLY to build the set of ids this
// database currently recognizes as real users — it is never written.
// generateFullBackup() (backup-actions.ts) never includes passwordHash,
// so a "restored" User row could never actually be logged into;
// fabricating one would be strictly worse than the alternative the
// schema already supports: nulling out a createdById/updatedById that
// doesn't resolve to a real user here (both fields are nullable by
// design specifically for this kind of case).
//
// Known, deliberate simplifications (documented here once rather than
// scattered as silent gaps):
//   - Order/OrderItem conflict detection compares scalar business fields
//     only (dates, amounts, status, styles) — NOT pocketOptionId/
//     pattiOptionId/panchaOptionId/defaultMeasurementSnapshotId/
//     measurementSnapshotId. Those are resolved (possibly remapped) and
//     always applied on import, but are not part of the conflict
//     surface for an already-existing row — comparing them by resolved
//     semantic equality (not raw id) would need materially more code
//     for comparatively low-stakes fields.
//   - A MeasurementSnapshot whose id already exists in the target is
//     always treated as already-consistent (no content re-check) —
//     correct under the model's own "never mutated after creation"
//     invariant, but this file does not independently re-verify that
//     invariant byte-for-byte.
//   - DesignOption has no `updatedAt` column at all, so its conflict
//     entries carry an empty `currentVersion` — restore-apply.ts applies
//     a DesignOption resolution as a plain (non-version-guarded) update,
//     not an atomic conditional one, because there is no version token
//     to guard with. This is a narrower safety guarantee than every
//     other model's Operation B, reported explicitly, not hidden.

function normDecimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null && typeof (v as { toString?: unknown }).toString === "function") {
    return (v as { toString(): string }).toString();
  }
  return String(v);
}
function normDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function normStr(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function normBool(v: unknown): boolean | null {
  return v === null || v === undefined ? null : Boolean(v);
}
// sortOrder (DesignOption) is a real Prisma Int field — comparing it as
// a string (normStr) was fine for display/equality, but restore-apply.ts
// feeds a diff entry's `backup` value straight back into Prisma's
// `data`, where an Int field needs an actual number, not a numeric
// string. A dedicated "int" kind keeps the comparison AND the value fed
// back to Prisma consistent, rather than silently handing Prisma a
// string for a field it will reject.
function normInt(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
type FieldKind = "decimal" | "date" | "str" | "bool" | "int";
function diffFields(
  current: Record<string, unknown>,
  backup: Record<string, unknown>,
  specs: { field: string; kind: FieldKind }[]
): { field: string; current: unknown; backup: unknown }[] {
  const normalize = { decimal: normDecimal, date: normDate, str: normStr, bool: normBool, int: normInt } satisfies Record<FieldKind, (v: unknown) => unknown>;
  const diffs: { field: string; current: unknown; backup: unknown }[] = [];
  for (const spec of specs) {
    const fn = normalize[spec.kind];
    const c = fn(current[spec.field]);
    const b = fn(backup[spec.field]);
    if (c !== b) diffs.push({ field: spec.field, current: c, backup: b });
  }
  return diffs;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export async function buildRestorePlan(envelope: ParsedBackupEnvelope, restoreAttemptId: string): Promise<RestorePlan> {
  const imports: ImportCandidate[] = [];
  const conflicts: ConflictCandidate[] = [];
  const quarantined: QuarantinedRecord[] = [];
  let nulledCreatorReferences = 0;
  const alreadyConsistentByModel: Record<RestoreModelName, number> = {
    customers: 0,
    measurements: 0,
    coatMeasurements: 0,
    orders: 0,
    orderItems: 0,
    measurementSnapshots: 0,
    designOptions: 0,
    shopSettings: 0,
  };

  function quarantine(model: RestoreModelName, label: string, reason: string) {
    quarantined.push({ model, label, reason });
  }

  // ── Users — reference only, never written ──────────────────────────
  const validUserIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  function resolveCreatorRef(id: unknown): string | null {
    if (typeof id !== "string" || !id) return null;
    if (validUserIds.has(id)) return id;
    nulledCreatorReferences++;
    return null;
  }

  // ── DesignOption — structural slot keyed by (category, code) ───────
  const designOptionIdRemap: Record<string, string> = {};
  const designOptionIdByBackupId = new Map<string, string>();
  const existingDesignOptions = await prisma.designOption.findMany();
  const designOptionByNaturalKey = new Map(existingDesignOptions.map((d) => [`${d.category}:${d.code}`, d]));
  const designOptionById = new Map(existingDesignOptions.map((d) => [d.id, d]));

  for (const raw of envelope.data.designOptions) {
    if (!isRecord(raw)) {
      quarantine("designOptions", "(malformed row)", "Record is not a JSON object.");
      continue;
    }
    const category = raw.category;
    const code = raw.code;
    if (typeof category !== "string" || typeof code !== "string") {
      quarantine("designOptions", String(raw.id ?? "(unknown)"), "Missing category or code.");
      continue;
    }
    const naturalKey = `${category}:${code}`;
    const backupId = typeof raw.id === "string" ? raw.id : null;
    const existingByKey = designOptionByNaturalKey.get(naturalKey);
    if (existingByKey) {
      designOptionIdRemap[naturalKey] = existingByKey.id;
      if (backupId) designOptionIdByBackupId.set(backupId, existingByKey.id);
      const diffs = diffFields(existingByKey, raw, [
        { field: "label", kind: "str" },
        { field: "sortOrder", kind: "int" },
        { field: "isActive", kind: "bool" },
      ]);
      if (diffs.length > 0) {
        conflicts.push({
          model: "designOptions",
          key: naturalKey,
          label: `${category} — ${code}`,
          diff: diffs,
          backupData: { category, code, label: raw.label, sortOrder: raw.sortOrder, isActive: raw.isActive },
          // No updatedAt column on this model at all — this is the one
          // model where currentValues (not currentVersion) is what
          // restore-apply.ts's atomic conditional update actually keys
          // on; see ConflictCandidate's own comment on why.
          currentVersion: "",
          currentValues: { id: existingByKey.id, label: existingByKey.label, sortOrder: existingByKey.sortOrder, isActive: existingByKey.isActive },
        });
      } else {
        alreadyConsistentByModel.designOptions++;
      }
      continue;
    }
    if (backupId && designOptionById.has(backupId)) {
      quarantine(
        "designOptions",
        `${naturalKey} (id ${backupId})`,
        `This id already belongs to a different design option (category/code mismatch) in this database.`
      );
      continue;
    }
    const useId = backupId ?? crypto.randomUUID();
    if (backupId) designOptionIdByBackupId.set(backupId, useId);
    designOptionIdRemap[naturalKey] = useId;
    imports.push({
      model: "designOptions",
      label: `${category} — ${code}`,
      data: { id: useId, category, code, label: raw.label ?? code, sortOrder: typeof raw.sortOrder === "number" ? raw.sortOrder : 0, isActive: raw.isActive ?? true },
    });
  }
  function resolveDesignOptionRef(backupId: unknown): string | null {
    if (typeof backupId !== "string" || !backupId) return null;
    const remapped = designOptionIdByBackupId.get(backupId);
    if (remapped) return remapped;
    if (designOptionById.has(backupId)) return backupId;
    return null;
  }

  // ── ShopSettings — singleton ────────────────────────────────────────
  const existingSettings = await prisma.shopSettings.findUnique({ where: { singleton: true } });
  const backupSettingsRow = envelope.data.shopSettings[0];
  if (isRecord(backupSettingsRow)) {
    if (!existingSettings) {
      imports.push({
        model: "shopSettings",
        label: "Shop Settings",
        data: {
          singleton: true,
          name: backupSettingsRow.name,
          phone: backupSettingsRow.phone,
          address: backupSettingsRow.address ?? null,
          tagline: backupSettingsRow.tagline ?? null,
          defaultPrices: backupSettingsRow.defaultPrices ?? {},
          defaultAdvancePercent: backupSettingsRow.defaultAdvancePercent ?? null,
        },
      });
    } else {
      const diffs = diffFields(existingSettings, backupSettingsRow, [
        { field: "name", kind: "str" },
        { field: "phone", kind: "str" },
        { field: "address", kind: "str" },
        { field: "tagline", kind: "str" },
        { field: "defaultAdvancePercent", kind: "decimal" },
      ]);
      const currentPricesStr = JSON.stringify(existingSettings.defaultPrices ?? {});
      const backupPricesStr = JSON.stringify(backupSettingsRow.defaultPrices ?? {});
      if (currentPricesStr !== backupPricesStr) {
        diffs.push({ field: "defaultPrices", current: existingSettings.defaultPrices, backup: backupSettingsRow.defaultPrices });
      }
      if (diffs.length > 0) {
        conflicts.push({
          model: "shopSettings",
          key: "singleton",
          label: "Shop Settings",
          diff: diffs,
          backupData: backupSettingsRow,
          currentVersion: existingSettings.updatedAt.toISOString(),
          currentValues: {},
        });
      } else {
        alreadyConsistentByModel.shopSettings++;
      }
    }
  }

  // ── Customer — identity by id; business key customerCode ───────────
  const existingCustomers = await prisma.customer.findMany();
  const existingCustomersById = new Map(existingCustomers.map((c) => [c.id, c]));
  const existingCustomerCodeToId = new Map(existingCustomers.map((c) => [c.customerCode, c.id]));
  const quarantinedCustomerIds = new Set<string>();
  const importedCustomerIds = new Set<string>();

  for (const raw of envelope.data.customers) {
    if (!isRecord(raw)) {
      quarantine("customers", "(malformed row)", "Record is not a JSON object.");
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id : null;
    const customerCode = typeof raw.customerCode === "string" ? raw.customerCode : null;
    if (!id || !customerCode) {
      quarantine("customers", String(raw.id ?? raw.customerCode ?? "(unknown)"), "Missing id or customerCode.");
      continue;
    }

    const existingById = existingCustomersById.get(id);
    if (existingById) {
      if (existingById.customerCode !== customerCode) {
        quarantine("customers", `${customerCode} (id ${id})`, `This id already exists with a different customerCode (${existingById.customerCode}) in this database.`);
        quarantinedCustomerIds.add(id);
        continue;
      }
      const diffs = diffFields(existingById, raw, [
        { field: "name", kind: "str" },
        { field: "phonePrimary", kind: "str" },
        { field: "phoneSecondary", kind: "str" },
        { field: "address", kind: "str" },
        { field: "deletedAt", kind: "date" },
      ]);
      if (diffs.length > 0) {
        conflicts.push({
          model: "customers",
          key: id,
          label: `${customerCode} — ${String(raw.name)}`,
          diff: diffs,
          backupData: raw,
          currentVersion: existingById.updatedAt.toISOString(),
          currentValues: {},
        });
      } else {
        alreadyConsistentByModel.customers++;
      }
      continue;
    }

    const collidingId = existingCustomerCodeToId.get(customerCode);
    if (collidingId && collidingId !== id) {
      quarantine("customers", `${customerCode} (id ${id})`, `customerCode ${customerCode} already belongs to a different customer (id ${collidingId}) in this database.`);
      quarantinedCustomerIds.add(id);
      continue;
    }

    imports.push({
      model: "customers",
      label: `${customerCode} — ${String(raw.name)}`,
      data: {
        id,
        customerCode,
        name: raw.name,
        phonePrimary: raw.phonePrimary,
        phoneSecondary: raw.phoneSecondary ?? null,
        address: raw.address ?? null,
        deletedAt: raw.deletedAt ?? null,
        createdById: resolveCreatorRef(raw.createdById),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
    });
    importedCustomerIds.add(id);
  }
  function customerWillExist(customerId: string): boolean {
    return existingCustomersById.has(customerId) || importedCustomerIds.has(customerId);
  }

  // ── Measurement — structural 1:1 slot keyed by customerId ──────────
  const existingMeasurements = await prisma.measurement.findMany();
  const measurementByCustomerId = new Map(existingMeasurements.map((m) => [m.customerId, m]));
  const MEASUREMENT_FIELDS: { field: string; kind: FieldKind }[] = [
    { field: "length", kind: "decimal" },
    { field: "shoulder", kind: "decimal" },
    { field: "sleeve", kind: "decimal" },
    { field: "neck", kind: "decimal" },
    { field: "chest", kind: "decimal" },
    { field: "waist", kind: "decimal" },
    { field: "hem", kind: "decimal" },
    { field: "armHole", kind: "decimal" },
    { field: "kohni", kind: "decimal" },
    { field: "shalwarLength", kind: "decimal" },
    { field: "pancha", kind: "decimal" },
    { field: "shalwarGheraReady", kind: "decimal" },
    { field: "shalwarPocket", kind: "bool" },
    { field: "note", kind: "str" },
  ];

  for (const raw of envelope.data.measurements) {
    if (!isRecord(raw)) {
      quarantine("measurements", "(malformed row)", "Record is not a JSON object.");
      continue;
    }
    const customerId = typeof raw.customerId === "string" ? raw.customerId : null;
    if (!customerId) {
      quarantine("measurements", String(raw.id ?? "(unknown)"), "Missing customerId.");
      continue;
    }
    if (quarantinedCustomerIds.has(customerId)) {
      quarantine("measurements", `customer ${customerId}`, "Owning customer was quarantined.");
      continue;
    }
    if (!customerWillExist(customerId)) {
      quarantine("measurements", `customer ${customerId}`, "Owning customer record is missing from both this database and the backup.");
      continue;
    }

    const existing = measurementByCustomerId.get(customerId);
    if (existing) {
      const diffs = diffFields(existing, raw, MEASUREMENT_FIELDS);
      if (diffs.length > 0) {
        conflicts.push({
          model: "measurements",
          key: customerId,
          label: `Measurement — customer ${customerId}`,
          diff: diffs,
          backupData: raw,
          currentVersion: existing.updatedAt.toISOString(),
          currentValues: {},
        });
      } else {
        alreadyConsistentByModel.measurements++;
      }
    } else {
      imports.push({
        model: "measurements",
        label: `Measurement — customer ${customerId}`,
        data: {
          id: raw.id,
          customerId,
          length: raw.length ?? null,
          shoulder: raw.shoulder ?? null,
          sleeve: raw.sleeve ?? null,
          neck: raw.neck ?? null,
          chest: raw.chest ?? null,
          waist: raw.waist ?? null,
          hem: raw.hem ?? null,
          armHole: raw.armHole ?? null,
          kohni: raw.kohni ?? null,
          shalwarLength: raw.shalwarLength ?? null,
          pancha: raw.pancha ?? null,
          shalwarPocket: raw.shalwarPocket ?? null,
          shalwarGheraReady: raw.shalwarGheraReady ?? null,
          note: raw.note ?? null,
          updatedById: resolveCreatorRef(raw.updatedById),
          updatedAt: raw.updatedAt,
        },
      });
    }
  }

  // ── CoatMeasurement — same shape, independent of Measurement ───────
  const existingCoatMeasurements = await prisma.coatMeasurement.findMany();
  const coatMeasurementByCustomerId = new Map(existingCoatMeasurements.map((m) => [m.customerId, m]));
  const COAT_MEASUREMENT_FIELDS: { field: string; kind: FieldKind }[] = [
    "coatLength",
    "coatShoulder",
    "coatChest",
    "coatWaist",
    "coatHipSeat",
    "coatSleeve",
    "coatArmHole",
    "coatBicep",
    "coatCuff",
    "coatNeck",
    "coatBackWidth",
    "coatFrontLength",
    "waistcoatLength",
    "waistcoatShoulder",
    "waistcoatChest",
    "waistcoatWaist",
    "waistcoatHipSeat",
    "waistcoatArmHole",
    "waistcoatNeck",
    "waistcoatBackWidth",
    "waistcoatFrontLength",
  ].map((field) => ({ field, kind: "decimal" as FieldKind }));
  COAT_MEASUREMENT_FIELDS.push({ field: "note", kind: "str" });

  for (const raw of envelope.data.coatMeasurements) {
    if (!isRecord(raw)) {
      quarantine("coatMeasurements", "(malformed row)", "Record is not a JSON object.");
      continue;
    }
    const customerId = typeof raw.customerId === "string" ? raw.customerId : null;
    if (!customerId) {
      quarantine("coatMeasurements", String(raw.id ?? "(unknown)"), "Missing customerId.");
      continue;
    }
    if (quarantinedCustomerIds.has(customerId)) {
      quarantine("coatMeasurements", `customer ${customerId}`, "Owning customer was quarantined.");
      continue;
    }
    if (!customerWillExist(customerId)) {
      quarantine("coatMeasurements", `customer ${customerId}`, "Owning customer record is missing from both this database and the backup.");
      continue;
    }

    const existing = coatMeasurementByCustomerId.get(customerId);
    if (existing) {
      const diffs = diffFields(existing, raw, COAT_MEASUREMENT_FIELDS);
      if (diffs.length > 0) {
        conflicts.push({
          model: "coatMeasurements",
          key: customerId,
          label: `Coat Measurement — customer ${customerId}`,
          diff: diffs,
          backupData: raw,
          currentVersion: existing.updatedAt.toISOString(),
          currentValues: {},
        });
      } else {
        alreadyConsistentByModel.coatMeasurements++;
      }
    } else {
      const data: Record<string, unknown> = { id: raw.id, customerId, updatedById: resolveCreatorRef(raw.updatedById), updatedAt: raw.updatedAt, note: raw.note ?? null };
      for (const spec of COAT_MEASUREMENT_FIELDS) {
        if (spec.field !== "note") data[spec.field] = raw[spec.field] ?? null;
      }
      imports.push({ model: "coatMeasurements", label: `Coat Measurement — customer ${customerId}`, data });
    }
  }

  // ── MeasurementSnapshot — identity by id only; immutable once written ─
  const existingSnapshotIds = new Set((await prisma.measurementSnapshot.findMany({ select: { id: true } })).map((s) => s.id));
  const importedSnapshotIds = new Set<string>();
  const SNAPSHOT_SCALAR_FIELDS = [
    "length",
    "shoulder",
    "sleeve",
    "neck",
    "chest",
    "waist",
    "hem",
    "armHole",
    "kohni",
    "shalwarLength",
    "pancha",
    "shalwarGheraReady",
    "coatLength",
    "coatShoulder",
    "coatChest",
    "coatWaist",
    "coatHipSeat",
    "coatSleeve",
    "coatArmHole",
    "coatBicep",
    "coatCuff",
    "coatNeck",
    "coatBackWidth",
    "coatFrontLength",
    "waistcoatLength",
    "waistcoatShoulder",
    "waistcoatChest",
    "waistcoatWaist",
    "waistcoatHipSeat",
    "waistcoatArmHole",
    "waistcoatNeck",
    "waistcoatBackWidth",
    "waistcoatFrontLength",
  ];

  for (const raw of envelope.data.measurementSnapshots) {
    if (!isRecord(raw)) {
      quarantine("measurementSnapshots", "(malformed row)", "Record is not a JSON object.");
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) {
      quarantine("measurementSnapshots", "(unknown)", "Missing id.");
      continue;
    }
    if (existingSnapshotIds.has(id)) {
      // Immutable once written — same id means same content, by the
      // model's own invariant (see this file's header comment).
      alreadyConsistentByModel.measurementSnapshots++;
      continue;
    }
    const data: Record<string, unknown> = { id, shalwarPocket: raw.shalwarPocket ?? null, note: raw.note ?? null, isBackfilled: raw.isBackfilled ?? false, createdAt: raw.createdAt };
    for (const field of SNAPSHOT_SCALAR_FIELDS) data[field] = raw[field] ?? null;
    imports.push({ model: "measurementSnapshots", label: `Measurement Snapshot ${id}`, data });
    importedSnapshotIds.add(id);
  }
  function snapshotWillExist(id: unknown): string | null {
    if (typeof id !== "string" || !id) return null;
    return existingSnapshotIds.has(id) || importedSnapshotIds.has(id) ? id : null;
  }

  // ── Order — identity by id; business key orderNumber ────────────────
  const existingOrders = await prisma.order.findMany();
  const existingOrdersById = new Map(existingOrders.map((o) => [o.id, o]));
  const existingOrderNumberToId = new Map(existingOrders.map((o) => [o.orderNumber, o.id]));
  const quarantinedOrderIds = new Set<string>();
  const importedOrderIds = new Set<string>();
  const ORDER_FIELDS: { field: string; kind: FieldKind }[] = [
    { field: "orderDate", kind: "date" },
    { field: "deliveryDate", kind: "date" },
    { field: "measurementMode", kind: "str" },
    { field: "suitType", kind: "str" },
    { field: "collarType", kind: "str" },
    { field: "bainType", kind: "str" },
    { field: "cuffType", kind: "str" },
    { field: "gheraType", kind: "str" },
    { field: "totalAmount", kind: "decimal" },
    { field: "advanceAmount", kind: "decimal" },
    { field: "balanceAmount", kind: "decimal" },
    { field: "princeCoatUnitPrice", kind: "decimal" },
    { field: "waistcoatUnitPrice", kind: "decimal" },
    { field: "status", kind: "str" },
    { field: "note", kind: "str" },
  ];

  for (const raw of envelope.data.orders) {
    if (!isRecord(raw)) {
      quarantine("orders", "(malformed row)", "Record is not a JSON object.");
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id : null;
    const orderNumber = typeof raw.orderNumber === "string" ? raw.orderNumber : null;
    const customerId = typeof raw.customerId === "string" ? raw.customerId : null;
    if (!id || !orderNumber || !customerId) {
      quarantine("orders", String(raw.orderNumber ?? raw.id ?? "(unknown)"), "Missing id, orderNumber, or customerId.");
      continue;
    }
    if (quarantinedCustomerIds.has(customerId) || !customerWillExist(customerId)) {
      quarantine("orders", `${orderNumber} (id ${id})`, "Owning customer was quarantined or is missing from both this database and the backup.");
      quarantinedOrderIds.add(id);
      continue;
    }

    const existingById = existingOrdersById.get(id);
    if (existingById) {
      if (existingById.orderNumber !== orderNumber) {
        quarantine("orders", `${orderNumber} (id ${id})`, `This id already exists with a different orderNumber (${existingById.orderNumber}) in this database.`);
        quarantinedOrderIds.add(id);
        continue;
      }
      const diffs = diffFields(existingById, raw, ORDER_FIELDS);
      if (diffs.length > 0) {
        conflicts.push({ model: "orders", key: id, label: `Order ${orderNumber}`, diff: diffs, backupData: raw, currentVersion: existingById.updatedAt.toISOString(), currentValues: {} });
      } else {
        alreadyConsistentByModel.orders++;
      }
      continue;
    }

    const collidingId = existingOrderNumberToId.get(orderNumber);
    if (collidingId && collidingId !== id) {
      quarantine("orders", `${orderNumber} (id ${id})`, `orderNumber ${orderNumber} already belongs to a different order (id ${collidingId}) in this database.`);
      quarantinedOrderIds.add(id);
      continue;
    }

    imports.push({
      model: "orders",
      label: `Order ${orderNumber}`,
      data: {
        id,
        orderNumber,
        customerId,
        orderDate: raw.orderDate,
        deliveryDate: raw.deliveryDate ?? null,
        measurementMode: raw.measurementMode,
        suitType: raw.suitType ?? null,
        collarType: raw.collarType ?? null,
        bainType: raw.bainType ?? null,
        cuffType: raw.cuffType ?? null,
        gheraType: raw.gheraType ?? null,
        pocketOptionId: resolveDesignOptionRef(raw.pocketOptionId),
        pattiOptionId: resolveDesignOptionRef(raw.pattiOptionId),
        panchaOptionId: resolveDesignOptionRef(raw.panchaOptionId),
        defaultMeasurementSnapshotId: snapshotWillExist(raw.defaultMeasurementSnapshotId),
        totalAmount: raw.totalAmount,
        advanceAmount: raw.advanceAmount,
        balanceAmount: raw.balanceAmount,
        princeCoatUnitPrice: raw.princeCoatUnitPrice ?? null,
        waistcoatUnitPrice: raw.waistcoatUnitPrice ?? null,
        status: raw.status,
        createdById: resolveCreatorRef(raw.createdById),
        note: raw.note ?? null,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      },
    });
    importedOrderIds.add(id);
  }
  function orderWillExist(orderId: string): boolean {
    return existingOrdersById.has(orderId) || importedOrderIds.has(orderId);
  }

  // ── OrderItem — structural slot keyed by (orderId, position) ───────
  const existingOrderItems = await prisma.orderItem.findMany();
  const orderItemByKey = new Map(existingOrderItems.map((i) => [`${i.orderId}:${i.position}`, i]));
  const ORDER_ITEM_FIELDS: { field: string; kind: FieldKind }[] = [
    { field: "suitType", kind: "str" },
    { field: "collarType", kind: "str" },
    { field: "bainType", kind: "str" },
    { field: "cuffType", kind: "str" },
    { field: "gheraType", kind: "str" },
    { field: "measurementMode", kind: "str" },
    { field: "coatGarmentSelection", kind: "str" },
  ];

  for (const raw of envelope.data.orderItems) {
    if (!isRecord(raw)) {
      quarantine("orderItems", "(malformed row)", "Record is not a JSON object.");
      continue;
    }
    const orderId = typeof raw.orderId === "string" ? raw.orderId : null;
    const position = typeof raw.position === "number" ? raw.position : null;
    if (!orderId || position === null) {
      quarantine("orderItems", String(raw.id ?? "(unknown)"), "Missing orderId or position.");
      continue;
    }
    if (quarantinedOrderIds.has(orderId) || !orderWillExist(orderId)) {
      quarantine("orderItems", `order ${orderId} #${position}`, "Owning order was quarantined or is missing from both this database and the backup.");
      continue;
    }

    const key = `${orderId}:${position}`;
    const existing = orderItemByKey.get(key);
    if (existing) {
      const diffs = diffFields(existing, raw, ORDER_ITEM_FIELDS);
      if (diffs.length > 0) {
        conflicts.push({ model: "orderItems", key, label: `Order item ${orderId} #${position}`, diff: diffs, backupData: raw, currentVersion: existing.updatedAt.toISOString(), currentValues: {} });
      } else {
        alreadyConsistentByModel.orderItems++;
      }
    } else {
      imports.push({
        model: "orderItems",
        label: `Order item ${orderId} #${position}`,
        data: {
          id: raw.id,
          orderId,
          position,
          measurementSnapshotId: snapshotWillExist(raw.measurementSnapshotId),
          suitType: raw.suitType ?? null,
          collarType: raw.collarType ?? null,
          bainType: raw.bainType ?? null,
          cuffType: raw.cuffType ?? null,
          gheraType: raw.gheraType ?? null,
          measurementMode: raw.measurementMode ?? null,
          coatGarmentSelection: raw.coatGarmentSelection ?? null,
          pocketOptionId: resolveDesignOptionRef(raw.pocketOptionId),
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        },
      });
    }
  }

  const perModelCounts: RestorePlan["summary"]["perModelCounts"] = {
    customers: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.customers },
    measurements: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.measurements },
    coatMeasurements: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.coatMeasurements },
    orders: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.orders },
    orderItems: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.orderItems },
    measurementSnapshots: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.measurementSnapshots },
    designOptions: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.designOptions },
    shopSettings: { imported: 0, conflicts: 0, quarantined: 0, alreadyConsistent: alreadyConsistentByModel.shopSettings },
  };
  for (const imp of imports) perModelCounts[imp.model].imported++;
  for (const conf of conflicts) perModelCounts[conf.model].conflicts++;
  for (const q of quarantined) perModelCounts[q.model].quarantined++;

  return {
    restoreAttemptId,
    imports,
    conflicts,
    quarantined,
    designOptionIdRemap,
    summary: {
      importCount: imports.length,
      conflictCount: conflicts.length,
      quarantineCount: quarantined.length,
      perModelCounts,
      nulledCreatorReferences,
    },
  };
}
