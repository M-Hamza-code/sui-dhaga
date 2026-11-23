"use server";

import { promises as fs } from "fs";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { validateBackupBytes } from "./restore-validate";
import { buildRestorePlan } from "./restore-plan";
import { applyOperationA, applyConflictResolution, takeSafetyBackup, type ConflictDecision } from "./restore-apply";
import { verifyPostRestoreConsistency } from "./restore-consistency";
import { uploadPathFor } from "./restore-paths";
import type { ApplyRestoreResult, PlanRestoreResult, RestoreModelName } from "./restore-types";

// Backup & Restore — admin-facing Server Actions. Every one of these
// starts with requireAdminSession() (never requireSession()) — plain
// authentication is not authorization to restore the whole database.
//
// Flow: uploadAndPlanRestore() (reads the already-streamed, already-
// size-checked, already-validated upload the Route Handler saved —
// see /api/restore/upload/route.ts) -> the admin reviews the plan's
// conflicts in the UI -> applyRestoreAttempt() takes the admin's
// per-record decisions and actually writes. The plan is always rebuilt
// fresh from the saved upload file at apply time, never trusted from
// what the client echoes back — protects against both tampering and
// simple staleness (something changed in the database between the two
// steps), on top of each individual conflict's own atomic conditional
// guard (restore-apply.ts's applyConflictResolution).

/**
 * Second half of the upload flow: the Route Handler already streamed
 * the bytes to disk under strict size limits and admin authorization
 * (see /api/restore/upload/route.ts) and handed back `restoreAttemptId`
 * + `uploadPath`. This Server Action re-reads that same file, validates
 * it (checksum/schema/record counts), and builds the restore plan.
 */
export async function planRestoreFromUpload(restoreAttemptId: string): Promise<PlanRestoreResult> {
  const session = await requireAdminSession();

  const uploadPath = uploadPathFor(restoreAttemptId);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(uploadPath);
  } catch {
    return { ok: false, error: "Uploaded file could not be found — it may have expired. Please upload again." };
  }

  const validated = validateBackupBytes(bytes);
  if (!validated.ok) {
    await prisma.restoreAttempt.update({ where: { id: restoreAttemptId }, data: { status: "FAILED", errorMessage: validated.error } });
    return { ok: false, error: validated.error };
  }

  await prisma.restoreAttempt.update({
    where: { id: restoreAttemptId },
    data: {
      status: "VALIDATING",
      backupFormat: validated.envelope.format,
      backupVersion: validated.envelope.version,
      backupCreatedAt: new Date(validated.envelope.createdAt),
      checksum: validated.checksum,
      recordCounts: validated.recordCounts,
      initiatedById: session.sub,
    },
  });

  const plan = await buildRestorePlan(validated.envelope, restoreAttemptId);

  await prisma.restoreAttempt.update({
    where: { id: restoreAttemptId },
    data: { status: plan.conflicts.length > 0 ? "AWAITING_RESOLUTION" : "VALIDATING", summary: plan.summary as unknown as object },
  });

  return {
    ok: true,
    restoreAttemptId,
    backupCreatedAt: validated.envelope.createdAt,
    recordCounts: validated.recordCounts,
    checksum: validated.checksum,
    importCount: plan.imports.length,
    conflicts: plan.conflicts,
    quarantined: plan.quarantined,
    nulledCreatorReferences: plan.summary.nulledCreatorReferences,
  };
}

/**
 * Final step: re-reads and re-validates the same uploaded file, rebuilds
 * the plan fresh (see this file's own header comment on why), takes the
 * pre-restore safety backup, applies Operation A, applies each decided
 * Operation B conflict (default "keep-current" for anything not
 * explicitly decided — the admin's decisions map only ever contains
 * entries for conflicts they actually acted on), verifies post-restore
 * consistency, and only then advances ShopSettings.restoreGeneration —
 * offline devices detect this on their next pull (see initial-sync.ts).
 */
export async function applyRestoreAttempt(restoreAttemptId: string, decisions: Record<string, ConflictDecision>): Promise<ApplyRestoreResult> {
  await requireAdminSession();

  const uploadPath = uploadPathFor(restoreAttemptId);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(uploadPath);
  } catch {
    return { ok: false, error: "Uploaded file could not be found — it may have expired. Please upload again." };
  }

  const validated = validateBackupBytes(bytes);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  await prisma.restoreAttempt.update({ where: { id: restoreAttemptId }, data: { status: "APPLYING" } });

  let safetyBackupPath: string;
  try {
    safetyBackupPath = await takeSafetyBackup(restoreAttemptId);
  } catch (err) {
    const message = `Could not write the pre-restore safety backup — aborting before any write. ${err instanceof Error ? err.message : String(err)}`;
    await prisma.restoreAttempt.update({ where: { id: restoreAttemptId }, data: { status: "FAILED", errorMessage: message } });
    return { ok: false, error: message };
  }
  await prisma.restoreAttempt.update({ where: { id: restoreAttemptId }, data: { safetyBackupPath } });

  const plan = await buildRestorePlan(validated.envelope, restoreAttemptId);

  let importedCounts: Record<RestoreModelName, number>;
  try {
    const result = await applyOperationA(plan.imports);
    importedCounts = result.created;
  } catch (err) {
    const message = `Operation A failed and was fully rolled back — no partial import was left behind. ${err instanceof Error ? err.message : String(err)}`;
    await prisma.restoreAttempt.update({ where: { id: restoreAttemptId }, data: { status: "FAILED", errorMessage: message, safetyBackupPath } });
    return { ok: false, error: message, safetyBackupPath };
  }

  let appliedConflicts = 0;
  let skippedConflicts = 0;
  const failedConflicts: { label: string; reason: string }[] = [];
  for (const conflict of plan.conflicts) {
    const decisionKey = `${conflict.model}__${conflict.key}`;
    const decision = decisions[decisionKey] ?? "keep-current";
    if (decision === "keep-current") {
      skippedConflicts++;
      continue;
    }
    const result = await applyConflictResolution(conflict, decision);
    if (result.ok) {
      appliedConflicts++;
    } else {
      failedConflicts.push({ label: conflict.label, reason: result.reason });
    }
  }

  const settings = await prisma.shopSettings.upsert({
    where: { singleton: true },
    create: { singleton: true, name: "Sui Dhaga", phone: "", restoreGeneration: 1 },
    update: { restoreGeneration: { increment: 1 } },
  });

  const consistencyIssues = await verifyPostRestoreConsistency({ safetyBackupPath, expectedRestoreGeneration: settings.restoreGeneration });

  await prisma.restoreAttempt.update({
    where: { id: restoreAttemptId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      summary: {
        ...plan.summary,
        importedCounts,
        appliedConflicts,
        skippedConflicts,
        failedConflicts,
        consistencyIssues,
      } as unknown as object,
    },
  });

  revalidatePath("/settings");

  return { ok: true, importedCounts, appliedConflicts, skippedConflicts, failedConflicts, consistencyIssues, safetyBackupPath };
}
