import { createHash } from "crypto";
import { RESTORE_MODEL_NAMES, SUPPORTED_BACKUP_FORMAT, SUPPORTED_BACKUP_VERSION, type ParsedBackupEnvelope, type RestoreModelName } from "./restore-types";

export type ValidateBackupResult =
  | {
      ok: true;
      envelope: ParsedBackupEnvelope;
      checksum: string;
      recordCounts: Record<RestoreModelName, number>;
    }
  | { ok: false; error: string };

/**
 * Checksum, JSON/schema validation, and record counts — all three in one
 * pass, since each needs the raw bytes/parsed shape the others also need.
 *
 * The checksum is a sha256 of the exact uploaded bytes — not verified
 * against anything (no second trusted source of the "right" checksum
 * exists for this backup format), but recorded in RestoreAttempt and
 * surfaced to the admin so they can compare it against one they computed
 * themselves when they made/downloaded the file, if they want that extra
 * assurance. Record counts are reported for the same reason: a cheap
 * sanity check ("does this look like the right backup?") before the
 * admin commits to anything, not a comparison against a stored
 * expectation.
 *
 * Schema validation here is deliberately shallow beyond the envelope
 * itself (format/version/the 8 expected arrays existing and being
 * arrays) — validating every nested field of every one of 8 different
 * record shapes would duplicate Prisma's own schema, and a malformed
 * individual record is instead caught later, per-record, by
 * restore-plan.ts/restore-apply.ts (never silently dropped — reported
 * as a quarantined/failed record, never a reason to abort the whole
 * restore over one bad row).
 */
export function validateBackupBytes(bytes: Buffer): ValidateBackupResult {
  const checksum = createHash("sha256").update(bytes).digest("hex");

  let text: string;
  try {
    text = bytes.toString("utf-8");
  } catch {
    return { ok: false, error: "Uploaded file is not valid UTF-8 text." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Uploaded file is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Uploaded file is not a JSON object." };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.format !== SUPPORTED_BACKUP_FORMAT) {
    return { ok: false, error: `Unrecognized backup format "${String(obj.format)}" — expected "${SUPPORTED_BACKUP_FORMAT}".` };
  }
  if (obj.version !== SUPPORTED_BACKUP_VERSION) {
    return {
      ok: false,
      error: `Unsupported backup version ${String(obj.version)} — only version ${SUPPORTED_BACKUP_VERSION} is currently supported.`,
    };
  }
  if (typeof obj.createdAt !== "string") {
    return { ok: false, error: "Backup is missing its createdAt timestamp." };
  }
  if (typeof obj.data !== "object" || obj.data === null) {
    return { ok: false, error: "Backup is missing its data section." };
  }
  const data = obj.data as Record<string, unknown>;

  if (!Array.isArray(data.users)) {
    return { ok: false, error: "Backup data.users is missing or not an array." };
  }
  const recordCounts = {} as Record<RestoreModelName, number>;
  for (const model of RESTORE_MODEL_NAMES) {
    if (!Array.isArray(data[model])) {
      return { ok: false, error: `Backup data.${model} is missing or not an array.` };
    }
    recordCounts[model] = (data[model] as unknown[]).length;
  }

  const envelope: ParsedBackupEnvelope = {
    format: obj.format,
    version: obj.version,
    createdAt: obj.createdAt,
    data: {
      users: data.users,
      customers: data.customers as unknown[],
      measurements: data.measurements as unknown[],
      coatMeasurements: data.coatMeasurements as unknown[],
      orders: data.orders as unknown[],
      orderItems: data.orderItems as unknown[],
      measurementSnapshots: data.measurementSnapshots as unknown[],
      designOptions: data.designOptions as unknown[],
      shopSettings: data.shopSettings as unknown[],
    },
  };

  return { ok: true, envelope, checksum, recordCounts };
}
