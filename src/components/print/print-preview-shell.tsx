import { PageHeader } from "@/components/page-header";
import { PrintButton } from "./print-button";

// Shared wrapper for both print-preview routes (Step 16). On screen this
// is a normal Step 10 page: the existing shared PageHeader (nav, search,
// logout — its own back link doubles as the required "Back" control) plus
// a Print button. Under print media, the header and Print button vanish
// (`print:hidden`) and only the printable document itself remains, on a
// plain white background with generous page margins — never dependent on
// screen-only colors to stay legible on paper.
export function PrintPreviewShell({
  headerTitle,
  backHref,
  backLabel,
  printLabel,
  wide = false,
  children,
}: {
  headerTitle: string;
  backHref: string;
  backLabel: string;
  printLabel: string;
  // Step 23: the Work Order's on-screen preview is now a landscape A4
  // two-up layout, too wide for the Receipt's narrow max-w-2xl. Opt-in
  // only — omitted (false), every existing consumer (Receipt) renders
  // byte-for-byte the same as before. Print output is unaffected either
  // way: `print:max-w-none` already removes this constraint for print,
  // regardless of `wide`.
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper print:min-h-0 print:bg-white">
      {/* Real page margins for the printed sheet — Tailwind has no @page
          utility, so this one rule is plain CSS rather than a new global
          stylesheet. Work Order (Step 23) overrides both size and margin
          for its own route via its own separate <style> tag — @page
          rules cascade by property, and since each route is its own full
          page load, that override can never reach the Receipt page. */}
      <style>{"@media print { @page { margin: 14mm; } }"}</style>

      <div className="print:hidden">
        <PageHeader title={headerTitle} backHref={backHref} backLabel={backLabel} />
      </div>

      <div className={`mx-auto p-6 print:max-w-none print:p-0 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
        <div className="mb-4 flex justify-end print:hidden">
          <PrintButton label={printLabel} />
        </div>

        {/* Step 61 (wide-mode only, i.e. Work Order) — this card now
            shrink-wraps to its own content's actual width (w-fit) instead
            of always stretching to the full max-w-5xl bound above it.
            Step 60 already made a single-suit sheet its own correct
            (roughly half) width; this card used to stay full-width
            regardless, so a lone sheet sat centered deep inside a much
            wider bordered box — the visible gap between the receipt's
            own border and this card's border. w-fit removes that: the
            card now hugs whichever sheet needs the most width, so the
            gap is just this card's own p-8 (32px, already ≤34px).
            print:w-full print:mx-0 restores the original always-full-
            width behavior for the printed page, completely unaffected —
            print output only ever uses the sheet's own print: sizing
            (Step 60), never this card's screen-only width. Receipt
            (wide=false) is entirely untouched, exactly as before. */}
        <div
          className={`rounded-sm border border-rule bg-card p-8 text-graphite print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black ${
            wide ? "mx-auto w-fit print:mx-0 print:w-full" : ""
          }`}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
