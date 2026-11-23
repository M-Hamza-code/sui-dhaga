import { requireAdminSession } from "@/lib/auth";
import { RestorePanel } from "@/components/restore/restore-panel";

// Backup & Restore — admin-only page. requireAdminSession() redirects
// away immediately for anyone who isn't an authenticated admin, before
// anything here renders — the actual upload/plan/apply logic all lives
// in restore-actions.ts/the upload Route Handler, each of which
// independently re-checks this same authorization (a page guard alone
// is never sufficient — see auth.ts's own comment on why every Server
// Action/Route Handler must check for itself).
export default async function RestorePage() {
  await requireAdminSession();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-graphite">Restore from a backup file</h1>
      <p className="mt-2 text-sm text-graphite/70">
        Upload a <code>sui-dhaga-backup</code> file (version 1). Missing records are imported automatically. Records that already
        exist here but differ from the backup are listed individually below, defaulting to <strong>Keep Current</strong> — nothing
        is overwritten unless you explicitly choose otherwise for that specific record.
      </p>
      <RestorePanel />
    </main>
  );
}
