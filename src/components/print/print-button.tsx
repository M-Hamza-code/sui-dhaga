"use client";

// Real browser printing (Step 16 Part L) — no fake button, no PDF
// generation of its own. window.print() opens the browser's own print
// dialog against the current page, which the print:* CSS on the
// surrounding preview shell has already prepared (chrome hidden, only
// the document itself shown).
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-sm bg-indigo px-4 py-2 text-sm text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2"
    >
      {label}
    </button>
  );
}
