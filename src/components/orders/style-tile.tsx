"use client";

// Image tile for the S3 style block (design brief §6b): "~96px, selected
// state is a solid indigo border plus a check mark — not a subtle tint."
//
// Step 58 — corrected per direct feedback on Step 57's first pass: the
// box is a plain SQUARE (h-24 w-24, matching this component's original
// ~96px brief) that holds ONLY the image, filling it edge-to-edge
// (object-cover — crops to the square rather than shrinking the photo to
// "fit nicely" with padding around it; never stretches/distorts). The
// label now sits OUTSIDE and below that bordered square — no text is
// rendered inside the box anymore, only the photo. `selected`/`onSelect`/
// `aria-pressed` and the checkmark badge are unchanged in behavior, the
// checkmark just now sits on the photo instead of on empty tile padding.
export function StyleTile({
  label,
  selected,
  onSelect,
  imageSrc,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  /** Optional — a tile with no photo (e.g. "Not specified") still keeps the same fixed square box, just empty inside. */
  imageSrc?: string;
}) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="group flex w-24 flex-none flex-col items-center gap-1 text-center">
      {/* The square image box — every tile's box is this exact same
          h-24 w-24, image or not, so every option lines up identically
          regardless of the source photo's own dimensions. */}
      <span
        className={`relative flex h-24 w-24 flex-none items-center justify-center overflow-hidden rounded-sm border-2 transition ${
          selected ? "border-indigo bg-indigo/5 shadow-sm" : "border-rule bg-card group-hover:border-graphite/40 group-hover:bg-paper"
        }`}
      >
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- fixed local /public asset, not a remote/optimizable image
          <img src={imageSrc} alt="" draggable={false} className="h-full w-full object-cover" />
        )}
        {selected && (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo text-[10px] leading-none text-white shadow">
            ✓
          </span>
        )}
      </span>
      {/* The name — outside the box border, directly below it. */}
      <span className={`px-1 text-[11px] font-medium leading-tight ${selected ? "text-ink" : "text-graphite/70"}`}>{label}</span>
    </button>
  );
}
