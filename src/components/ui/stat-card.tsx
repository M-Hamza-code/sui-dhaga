import Link from "next/link";

// Step 46 — presentation-only. A single glanceable number for the
// Dashboard's stats row. Reused 4× (Due Today / Overdue / Outstanding /
// Ready); every value passed in is already computed by the page's own
// Prisma queries — this component never fetches or derives anything
// itself. `tone` only ever picks from the existing (plus one added, per
// the approved redesign) token meanings — amber for attention, success
// for a genuinely positive/completed count, indigo/graphite otherwise —
// never a new ad hoc color.
//
// Step 47 — optional `href`. When provided, the whole card becomes a
// single real <Link> (not a <button> wrapping a <Link>, not nested
// interactive elements) so it's one keyboard-reachable, click-anywhere
// target. Visual styling is identical either way; the only addition is
// a focus ring and hover treatment consistent with the rest of the app's
// existing link/card hover patterns.
export function StatCard({
  label,
  value,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "attention" | "positive";
  href?: string;
}) {
  const valueClass =
    tone === "attention" ? "text-amber" : tone === "positive" ? "text-success" : "text-graphite";

  const content = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-graphite/60">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-sm border border-rule bg-card p-4 shadow-sm transition hover:border-indigo/40 hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
      >
        {content}
      </Link>
    );
  }

  return <div className="rounded-sm border border-rule bg-card p-4 shadow-sm">{content}</div>;
}
