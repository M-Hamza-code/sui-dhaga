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
  // A row of four cards previously rendered every number at identical
  // weight, so "0 overdue" shouted as loudly as "Rs. 3,000.00
  // outstanding" and the eye had nothing to land on. A zero is the
  // absence of work — it should recede, and the caller already tells us
  // when a number matters by passing a non-neutral tone.
  const isZero = value === 0 || value === "0";
  const valueClass =
    tone === "attention"
      ? "text-amber"
      : tone === "positive"
        ? "text-success"
        : isZero
          ? "text-graphite/35"
          : "text-graphite";

  const content = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-graphite/55">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl ${valueClass}`}>{value}</p>
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
