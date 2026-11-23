// Regression test for the DesignOption Operation B concurrency fix
// (src/lib/restore/restore-plan.ts + restore-apply.ts) — a genuine
// atomic compare-and-swap keyed on the record's id plus its plan-time
// current field values (this model has no `updatedAt` column, so there
// is no single version token to use the way every other model does).
//
// Imports the REAL production modules directly via `tsx` against
// sui_dhaga_test — not hand-copies.
//
// Run ONLY via: npx tsx test-upgrade-restore-designoption-concurrency.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(PROJECT_ROOT, ".env.test"));

const { assertTestDatabase } = await import("./scripts/lib/test-db-guard.mjs");
assertTestDatabase(process.env.DATABASE_URL);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}
const { buildRestorePlan } = await loadDefault("./src/lib/restore/restore-plan.ts");
const { applyConflictResolution } = await loadDefault("./src/lib/restore/restore-apply.ts");

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const suffix = Date.now();
const envelopeShell = (overrides = {}) => ({
  format: "sui-dhaga-backup",
  version: 1,
  createdAt: new Date().toISOString(),
  data: {
    users: [],
    customers: [],
    measurements: [],
    coatMeasurements: [],
    orders: [],
    orderItems: [],
    measurementSnapshots: [],
    designOptions: [],
    shopSettings: [],
    ...overrides,
  },
});

const createdDesignOptionIds = [];
const createdRestoreAttemptIds = [];

async function freshConflictFor(code, backupLabel, backupSortOrder) {
  const envelope = envelopeShell({
    designOptions: [{ id: `backup-${code}-${suffix}`, category: "POCKET", code, label: backupLabel, sortOrder: backupSortOrder, isActive: true }],
  });
  const attempt = await prisma.restoreAttempt.create({ data: { status: "PENDING" } });
  createdRestoreAttemptIds.push(attempt.id);
  const plan = await buildRestorePlan(envelope, attempt.id);
  return plan.conflicts.find((c) => c.model === "designOptions" && c.key === `POCKET:${code}`);
}

try {
  const code1 = `CONCTEST1-${suffix}`;
  const seeded1 = await prisma.designOption.create({ data: { category: "POCKET", code: code1, label: "Original Label", sortOrder: 1, isActive: true } });
  createdDesignOptionIds.push(seeded1.id);

  // ══════════════════════════════════════════════════════════════════
  // 1. Normal conflict resolution — the fields that differ are listed,
  //    currentValues captures ALL relevant fields regardless of diff
  // ══════════════════════════════════════════════════════════════════
  console.log("1. Normal conflict resolution: differing label is listed, currentValues captures the full row");
  const conflict1 = await freshConflictFor(code1, "Backup Label", 1);
  check("a conflict is produced for the differing label", !!conflict1);
  check("the diff names exactly the differing field (label)", conflict1 && conflict1.diff.length === 1 && conflict1.diff[0].field === "label");
  check("currentValues captures id/label/sortOrder/isActive, not just the diffed field", conflict1 && conflict1.currentValues.id === seeded1.id && conflict1.currentValues.sortOrder === 1 && conflict1.currentValues.isActive === true);

  const applyResult1 = await applyConflictResolution(conflict1, "apply-backup");
  check("apply-backup succeeds when nothing has changed since the plan was built", applyResult1.ok === true);
  const afterApply1 = await prisma.designOption.findUnique({ where: { id: seeded1.id } });
  check("only the flagged field (label) was actually written", afterApply1.label === "Backup Label" && afterApply1.sortOrder === 1 && afterApply1.isActive === true);

  // ══════════════════════════════════════════════════════════════════
  // 1b. A sortOrder-only conflict applies as a real Int, not a string
  //     (caught live while writing this test: diffFields compared/fed
  //     sortOrder back as a string, which Prisma's Int column rejects —
  //     fixed with a dedicated "int" FieldKind).
  // ══════════════════════════════════════════════════════════════════
  console.log("1b. sortOrder-only conflict applies as a real Int, not a numeric string");
  const code1b = `CONCTEST1B-${suffix}`;
  const seeded1b = await prisma.designOption.create({ data: { category: "POCKET", code: code1b, label: "Same Label", sortOrder: 5, isActive: true } });
  createdDesignOptionIds.push(seeded1b.id);
  const envelope1b = envelopeShell({ designOptions: [{ id: `backup-${code1b}-${suffix}`, category: "POCKET", code: code1b, label: "Same Label", sortOrder: 42, isActive: true }] });
  const attempt1b = await prisma.restoreAttempt.create({ data: { status: "PENDING" } });
  createdRestoreAttemptIds.push(attempt1b.id);
  const plan1b = await buildRestorePlan(envelope1b, attempt1b.id);
  const conflict1b = plan1b.conflicts.find((c) => c.model === "designOptions" && c.key === `POCKET:${code1b}`);
  check("a sortOrder-only difference is listed as the sole diffed field", conflict1b && conflict1b.diff.length === 1 && conflict1b.diff[0].field === "sortOrder");
  check("the diff's backup value is a real number, not a string", conflict1b && typeof conflict1b.diff[0].backup === "number");
  const applyResult1b = await applyConflictResolution(conflict1b, "apply-backup");
  check("applying a sortOrder-only conflict succeeds (no Prisma Int-type error)", applyResult1b.ok === true);
  const afterApply1b = await prisma.designOption.findUnique({ where: { id: seeded1b.id } });
  check("the stored sortOrder is a real number equal to 42", afterApply1b.sortOrder === 42);

  // ══════════════════════════════════════════════════════════════════
  // 2. Unchanged values -> successful apply (keep-current is a no-op;
  //    re-running apply-backup against the SAME unchanged state again
  //    would now correctly see label already matches backup -> no
  //    conflict at all. Verify via a fresh plan.)
  // ══════════════════════════════════════════════════════════════════
  console.log("2. Unchanged values since the last apply -> no conflict, nothing to resolve");
  const envelopeSame = envelopeShell({ designOptions: [{ id: `backup-${code1}-${suffix}`, category: "POCKET", code: code1, label: "Backup Label", sortOrder: 1, isActive: true }] });
  const attemptSame = await prisma.restoreAttempt.create({ data: { status: "PENDING" } });
  createdRestoreAttemptIds.push(attemptSame.id);
  const planSame = await buildRestorePlan(envelopeSame, attemptSame.id);
  check("no conflict is produced once content genuinely matches", !planSame.conflicts.some((c) => c.model === "designOptions" && c.key === `POCKET:${code1}`));

  // ══════════════════════════════════════════════════════════════════
  // 3. Concurrent edit AFTER the plan was built -> stale-plan, not a
  //    silent overwrite of the newer value
  // ══════════════════════════════════════════════════════════════════
  console.log("3. A concurrent edit after the plan was built -> stale-plan, the newer value survives");
  const code3 = `CONCTEST3-${suffix}`;
  const seeded3 = await prisma.designOption.create({ data: { category: "POCKET", code: code3, label: "Pre-Plan Label", sortOrder: 2, isActive: true } });
  createdDesignOptionIds.push(seeded3.id);
  const conflict3 = await freshConflictFor(code3, "Backup Wants This", 2);
  check("conflict captured for the pre-plan label", !!conflict3);

  // Simulate a genuinely concurrent edit via the normal (unguarded) path
  // AFTER the plan already captured its own snapshot of "current".
  await prisma.designOption.update({ where: { id: seeded3.id }, data: { label: "Someone Else Edited This Meanwhile" } });

  const applyResult3 = await applyConflictResolution(conflict3, "apply-backup");
  check("applying against a now-stale plan is rejected as stale-plan, not silently applied", applyResult3.ok === false && applyResult3.reason === "stale-plan");
  const afterStale3 = await prisma.designOption.findUnique({ where: { id: seeded3.id } });
  check("the newer (concurrent) value survives untouched — never overwritten by the backup", afterStale3.label === "Someone Else Edited This Meanwhile");

  // ══════════════════════════════════════════════════════════════════
  // 4. True concurrency — a restore apply-backup racing a plain
  //    concurrent edit via Promise.all. Whichever one's reported
  //    outcome is "success" must be exactly what's actually stored —
  //    no corruption, no silent loss, no mismatch between what either
  //    call reports and what's really in the database.
  // ══════════════════════════════════════════════════════════════════
  console.log("4. Genuine concurrent race: reported outcomes always match the real final state");
  const code4 = `CONCTEST4-${suffix}`;
  const seeded4 = await prisma.designOption.create({ data: { category: "POCKET", code: code4, label: "Race Start", sortOrder: 3, isActive: true } });
  createdDesignOptionIds.push(seeded4.id);
  const conflict4 = await freshConflictFor(code4, "Race Backup Value", 3);

  const [restoreOutcome, plainEditOutcome] = await Promise.all([
    applyConflictResolution(conflict4, "apply-backup"),
    prisma.designOption.update({ where: { id: seeded4.id }, data: { label: "Race Concurrent Edit" } }).then(() => "plain-edit-committed"),
  ]);
  const finalRow4 = await prisma.designOption.findUnique({ where: { id: seeded4.id } });
  check("the plain concurrent edit always commits (it has no guard of its own)", plainEditOutcome === "plain-edit-committed");
  if (restoreOutcome.ok) {
    check("if the restore reports success, the backup's value is genuinely what's stored", finalRow4.label === "Race Backup Value");
  } else {
    check("if the restore reports stale-plan, the concurrent edit's value is genuinely what's stored (no silent corruption)", finalRow4.label === "Race Concurrent Edit" && restoreOutcome.reason === "stale-plan");
  }
  check("the final state is one of exactly the two intended values, never a third/corrupted value", finalRow4.label === "Race Backup Value" || finalRow4.label === "Race Concurrent Edit");

  // ══════════════════════════════════════════════════════════════════
  // 5. Existing result format / UI contract preserved
  // ══════════════════════════════════════════════════════════════════
  console.log("5. Result format unchanged — {ok:true} / {ok:false, reason}, same shape as every other model");
  check("success shape is exactly {ok:true}", Object.keys(applyResult1).sort().join(",") === "ok");
  check("failure shape includes a reason field matching the existing union", "reason" in applyResult3 && (applyResult3.reason === "stale-plan" || applyResult3.reason === "not-found"));
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  for (const id of createdDesignOptionIds) {
    await prisma.designOption.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdRestoreAttemptIds) {
    await prisma.restoreAttempt.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
