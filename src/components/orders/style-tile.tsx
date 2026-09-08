"use client";

// Image tile for the S3 style block (design brief §6b): "~96px, selected
// state is a solid indigo border plus a check mark — not a subtle tint."
// No real photographs from the shop's order pad exist yet, so this is an
// HONEST placeholder — a plain labelled box, never a fake or generic stock
// icon pretending to be the real illustration. Swapping in real artwork
// later only means giving this component an `imageSrc` prop; the
// selection behaviour and markup here already match the brief.
//
// Step 49 — presentation-only polish: the selected state now carries a
// faint indigo background tint (in addition to the brief's required
// solid border + check mark, both unchanged) so a selected tile reads
// clearly even at a glance across a row of many, and the unselected/
// hover states are a touch more defined. `selected`/`onSelect`/
// `aria-pressed` and the label text are completely unchanged.
export function StyleTile({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex h-24 w-24 flex-none flex-col items-center justify-center gap-1 rounded-sm border-2 px-2 text-center text-xs leading-tight transition ${
        selected
          ? "border-indigo bg-indigo/5 text-ink shadow-sm"
          : "border-rule bg-card text-graphite/70 hover:border-graphite/40 hover:bg-paper"
      }`}
    >
      {selected && (
        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo text-[10px] leading-none text-white">
          ✓
        </span>
      )}
      <span className="px-1 font-medium">{label}</span>
    </button>
  );
}
