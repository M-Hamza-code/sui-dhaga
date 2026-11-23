"use client";

// Backup & Restore — the admin-facing flow: upload -> plan -> resolve
// each conflict -> apply. Deliberately minimal/functional styling, not
// a polished design pass — the priority for this feature was the
// engine's own correctness and safety, not this page's visual design.
import { useState } from "react";
import { planRestoreFromUpload, applyRestoreAttempt } from "@/lib/restore/restore-actions";
import type { ApplyRestoreResult, ConflictCandidate, PlanRestoreResult, QuarantinedRecord } from "@/lib/restore/restore-types";
import type { ConflictDecision } from "@/lib/restore/restore-apply";

type Step = "idle" | "uploading" | "planned" | "applying" | "done";

export function RestorePanel() {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanRestoreResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ConflictDecision>>({});
  const [applyResult, setApplyResult] = useState<ApplyRestoreResult | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setStep("uploading");
    try {
      const uploadRes = await fetch("/api/restore/upload", { method: "POST", body: file });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok || !uploadBody.ok) {
        setError(uploadBody.error ?? `Upload failed (${uploadRes.status})`);
        setStep("idle");
        return;
      }
      const planResult = await planRestoreFromUpload(uploadBody.restoreAttemptId);
      if (!planResult.ok) {
        setError(planResult.error ?? "Could not analyze this backup.");
        setStep("idle");
        return;
      }
      setPlan(planResult);
      setDecisions({});
      setStep("planned");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("idle");
    }
  }

  function decisionKey(conflict: ConflictCandidate): string {
    return `${conflict.model}__${conflict.key}`;
  }

  async function handleApply() {
    if (!plan?.restoreAttemptId) return;
    setStep("applying");
    setError(null);
    try {
      const result = await applyRestoreAttempt(plan.restoreAttemptId, decisions);
      if (!result.ok) {
        setError(result.error ?? "Restore failed.");
        setStep("planned");
        return;
      }
      setApplyResult(result);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("planned");
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {step === "idle" && (
        <div>
          <input type="file" accept=".json,application/json" onChange={handleUpload} />
        </div>
      )}
      {step === "uploading" && <p className="text-sm text-graphite/70">Uploading and analyzing…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {plan && (step === "planned" || step === "applying") && (
        <div className="space-y-4">
          <div className="rounded border border-rule p-4 text-sm">
            <p>Backup created: {plan.backupCreatedAt}</p>
            <p>Checksum (sha256): <code className="break-all">{plan.checksum}</code></p>
            <p>Record counts: {plan.recordCounts && Object.entries(plan.recordCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}</p>
            <p className="mt-2 font-semibold">{plan.importCount} record(s) will be imported (nothing here already exists).</p>
            {typeof plan.nulledCreatorReferences === "number" && plan.nulledCreatorReferences > 0 && (
              <p className="text-xs text-graphite/70">
                {plan.nulledCreatorReferences} "created/updated by" reference(s) point to a user not present here and will be left blank.
              </p>
            )}
          </div>

          {plan.quarantined && plan.quarantined.length > 0 && (
            <div className="rounded border border-amber-400 bg-amber-50 p-4 text-sm">
              <p className="font-semibold">{plan.quarantined.length} record(s) were skipped entirely (never imported or modified):</p>
              <ul className="mt-2 list-disc pl-5">
                {plan.quarantined.map((q: QuarantinedRecord, i: number) => (
                  <li key={i}>
                    {q.label} — {q.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.conflicts && plan.conflicts.length > 0 && (
            <div className="rounded border border-rule p-4 text-sm">
              <p className="font-semibold">{plan.conflicts.length} record(s) differ from the backup — choose what to do for each:</p>
              <table className="mt-3 w-full text-left text-xs">
                <thead>
                  <tr>
                    <th className="pb-1">Record</th>
                    <th className="pb-1">Differs on</th>
                    <th className="pb-1">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.conflicts.map((conflict: ConflictCandidate) => {
                    const key = decisionKey(conflict);
                    return (
                      <tr key={key} className="border-t border-rule/50">
                        <td className="py-2 pr-2">{conflict.label}</td>
                        <td className="py-2 pr-2">
                          {conflict.diff.map((d) => (
                            <div key={d.field}>
                              {d.field}: <em>{String(d.current)}</em> → {String(d.backup)}
                            </div>
                          ))}
                        </td>
                        <td className="py-2">
                          <select
                            value={decisions[key] ?? "keep-current"}
                            onChange={(e) => setDecisions((prev) => ({ ...prev, [key]: e.target.value as ConflictDecision }))}
                            className="rounded border border-rule px-2 py-1"
                          >
                            <option value="keep-current">Keep Current</option>
                            <option value="apply-backup">Apply Backup Value</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            onClick={handleApply}
            disabled={step === "applying"}
            className="rounded bg-graphite px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {step === "applying" ? "Applying…" : "Apply Restore"}
          </button>
        </div>
      )}

      {step === "done" && applyResult && (
        <div className="rounded border border-green-500 bg-green-50 p-4 text-sm">
          <p className="font-semibold">Restore complete.</p>
          <p>Imported: {applyResult.importedCounts && Object.entries(applyResult.importedCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}</p>
          <p>
            Conflicts applied: {applyResult.appliedConflicts}, kept as-is: {applyResult.skippedConflicts}
          </p>
          {applyResult.failedConflicts && applyResult.failedConflicts.length > 0 && (
            <div>
              <p className="font-semibold text-amber-700">Some decisions could not be applied (the record changed again before this ran):</p>
              <ul className="list-disc pl-5">
                {applyResult.failedConflicts.map((f, i) => (
                  <li key={i}>
                    {f.label} — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {applyResult.consistencyIssues && applyResult.consistencyIssues.length > 0 && (
            <div>
              <p className="font-semibold text-red-700">Post-restore consistency issues found:</p>
              <ul className="list-disc pl-5">
                {applyResult.consistencyIssues.map((issue, i) => (
                  <li key={i}>
                    [{issue.kind}] {issue.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2 text-xs text-graphite/70">Pre-restore safety backup saved at: {applyResult.safetyBackupPath}</p>
        </div>
      )}
    </div>
  );
}
