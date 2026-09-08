"use client";

// Header backup/export controls (Step 19) — replaces the Step 10 "Backup:
// Not yet available" indicator and disabled Export button with real,
// working actions. Two separate controls, matching what they actually
// do: "Backup data" is a single click that downloads the full JSON
// backup immediately; "Export" opens a small menu for the two CSV
// exports. Full Backup isn't repeated as a third item in that menu —
// it already has its own direct, more prominent entry point here, so
// listing it twice would just be a second way to do the identical thing.
//
// Step 34 reused this exact component, unchanged, inside the new S6
// Settings Backup section (in addition to its original spot in the
// global header). Step 35 adds the "last successful backup" indicator
// the Settings section was still missing — see backup-status.ts for why
// this is framed as "backup," not "sync." It's opt-in via
// `showLastBackupTime` (default off) so the header's own appearance and
// behavior stay pixel-identical to before; only the Settings instance
// requests it.
import { useEffect, useRef, useState, useTransition } from "react";
import { generateFullBackup, generateCustomersCsv, generateOrdersCsv } from "@/lib/backup-actions";
import { downloadTextFile, todayFileDate } from "@/lib/download-file";
import { recordBackupSuccess, getLastBackupTime } from "@/lib/backup-status";
import { formatDateTime } from "@/lib/format";
import { en } from "@/lib/locale";

export function BackupExportControls({ showLastBackupTime = false }: { showLastBackupTime?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // null until the client-only mount effect below runs, so server and
  // first-paint client HTML always agree (localStorage doesn't exist on
  // the server) — same hydration-safety pattern used elsewhere in this
  // app for client-only reads.
  const [lastBackupAt, setLastBackupAt] = useState<Date | null>(null);

  useEffect(() => {
    if (showLastBackupTime) {
      setLastBackupAt(getLastBackupTime());
    }
  }, [showLastBackupTime]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  // Called only from the line immediately after a successful download
  // below — never from a catch block, never speculatively. If the
  // preceding `await` throws, execution never reaches this call, so a
  // failed/cancelled export can never mark a false success.
  function onBackupSucceeded() {
    recordBackupSuccess();
    setLastBackupAt(new Date());
  }

  function handleBackup() {
    startTransition(async () => {
      const json = await generateFullBackup();
      downloadTextFile(`${en.backup.backupFilenamePrefix}-${todayFileDate()}.json`, json, "application/json");
      onBackupSucceeded();
    });
  }

  function handleExportCustomers() {
    setMenuOpen(false);
    startTransition(async () => {
      const csv = await generateCustomersCsv();
      downloadTextFile(`${en.backup.customersFilenamePrefix}-${todayFileDate()}.csv`, csv, "text/csv");
      onBackupSucceeded();
    });
  }

  function handleExportOrders() {
    setMenuOpen(false);
    startTransition(async () => {
      const csv = await generateOrdersCsv();
      downloadTextFile(`${en.backup.ordersFilenamePrefix}-${todayFileDate()}.csv`, csv, "text/csv");
      onBackupSucceeded();
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleBackup}
          disabled={isPending}
          className="whitespace-nowrap rounded-sm border border-rule px-3 py-1.5 text-sm text-graphite transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? en.backup.working : en.backup.backupButton}
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={isPending}
            aria-expanded={menuOpen}
            className="whitespace-nowrap rounded-sm border border-rule px-3 py-1.5 text-sm text-graphite transition hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
          >
            {en.backup.exportButton}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-sm border border-rule bg-card py-1">
              <button
                type="button"
                onClick={handleExportCustomers}
                className="block w-full px-3 py-2 text-left text-sm text-graphite hover:bg-paper"
              >
                {en.backup.exportCustomersCsv}
              </button>
              <button
                type="button"
                onClick={handleExportOrders}
                className="block w-full px-3 py-2 text-left text-sm text-graphite hover:bg-paper"
              >
                {en.backup.exportOrdersCsv}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Step 35 — opt-in only (Settings passes showLastBackupTime; the
          header does not, so its markup here is unchanged: nothing
          renders). Never fabricated: lastBackupAt is null until a real
          success has been recorded on this device. */}
      {showLastBackupTime && (
        <p className="mt-3 flex items-center gap-2 text-sm text-graphite">
          <span className="inline-block h-2 w-2 flex-none rounded-full bg-indigo" aria-hidden="true" />
          {lastBackupAt
            ? en.backup.lastBackupTemplate.replace("{time}", formatDateTime(lastBackupAt))
            : en.backup.noBackupYet}
        </p>
      )}
    </div>
  );
}
