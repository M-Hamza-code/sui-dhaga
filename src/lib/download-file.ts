"use client";

// Browser-side file download trigger (Step 19). The backup/export Server
// Actions (backup-actions.ts) only ever return already-generated text
// (JSON or CSV) — this is the one place that text becomes an actual
// downloaded file, via a throwaway Blob URL and a synthetic <a download>
// click. No server route, no third-party library.
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** "2026-08-30" — today's real date, for a meaningful backup/export filename. Never hardcoded. */
export function todayFileDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
