// Honest "not built yet" / empty-list message box. Used by the Order
// Board, the legacy /customers list, and the WhatsApp page.
//
// Step 49 — presentation-only polish (slightly larger padding, a touch
// more vertical rhythm between title/description) so it reads well as
// the Order Board's own empty state alongside its now more polished
// table/tabs. Same two props, same markup shape, every existing call
// site unchanged.
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-sm border border-dashed border-rule bg-card px-8 py-10 text-center">
      <p className="text-sm font-medium text-graphite">{title}</p>
      <p className="mt-1.5 text-sm text-graphite/60">{description}</p>
    </div>
  );
}
