// Step 46 — presentation-only. Formalizes the bordered-card-with-a-
// small-caps-title pattern already used throughout the app (Settings'
// fieldsets, Order Form's sections) into one reusable wrapper. Step 48
// adopted it for Customer Profile's Order History/Saved Measurements.
// Step 49 adopts it for the Order Form's own sections (Customer,
// Measurements, Styles, Payment), replacing their hand-rolled
// `<section><h2>` markup with this same shared card — and adds the one
// small addition that required: an optional `id`, passed straight
// through to the outer element, so the Order Form's sticky section nav
// can scroll to `#measurements` etc. Omitted, behavior is identical to
// before (id is simply absent) — every existing call site is unaffected.
// Step 50 — adds `scroll-mt-20` to the same outer element, fixing the
// Order Form's sticky nav covering the top of the section it just
// scrolled to. `scroll-margin-top` only ever affects the browser's own
// scroll-into-view targeting of an *anchored* element (one with a
// matching `id` in the URL fragment) — with no `id` (every other current
// call site), it is a complete no-op, so this is safe to apply
// unconditionally rather than adding a second prop just for the Order
// Form's own three/four anchored sections.
export function SectionCard({
  id,
  title,
  action,
  children,
}: {
  id?: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-20 rounded-sm border border-rule bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
