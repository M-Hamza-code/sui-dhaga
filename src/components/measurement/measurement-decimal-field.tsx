"use client";

// Shared predefined-dropdown-with-free-typing control for a single
// decimal measurement field. Used by BOTH measurement-form.tsx's and
// order-measurement-block.tsx's own DecimalRow — one implementation, two
// callers, so the two can never drift apart (the same reasoning this
// project already applies to customer-search-matching.ts).
//
// Why this exists instead of a native <select> or <input list>/
// <datalist>:
//   - A native <select> can ONLY ever hold one of its own listed
//     <option> values — it is structurally unable to accept a freely
//     typed custom number (e.g. "42.25") at all. That is a browser
//     limitation, not an app bug, so no amount of event-handler fixing
//     could have made a <select> satisfy "type any custom value."
//   - A native <input list>/<datalist> DOES support free typing, but
//     its suggestion popup is rendered by the browser's own UI chrome
//     (not this app's styling) and its open/close behavior isn't under
//     this app's control — which is why it didn't look or feel native
//     to the rest of Sui Dhaga.
// This component is a real, uncontrolled-feeling text <input> (so
// typing — including multi-digit and decimal entry — is never
// intercepted or transformed) paired with a small app-styled dropdown
// panel that this component renders and positions itself, opened on
// focus/click and closed on blur, Escape, outside-click, or a selection.
// Clicking an option fills the input; nothing here ever auto-advances a
// value by 0.5 or otherwise rewrites what the user typed.
import { useEffect, useRef, useState } from "react";
import { measurementOptionsFor, sanitizeDecimalKeystroke } from "@/lib/measurement-options";

export function MeasurementDecimalField({
  fieldKey,
  name,
  value,
  placeholder,
  onFocus,
  onChange,
  onEnter,
  className,
  ariaLabel,
}: {
  /** The measurement-fields.ts key — selects this field's own fixed range from measurement-options.ts. */
  fieldKey: string;
  /** The real form-field name submitted in FormData — identical role the old hidden input / <select> name played. */
  name: string;
  value: string;
  placeholder: string;
  onFocus: () => void;
  onChange: (value: string) => void;
  onEnter: () => void;
  /** Passed straight through to the <input> — callers keep their own exact sizing/border/amber-changed classes, so visual parity with the row around it is byte-identical to before. */
  className: string;
  /** Optional — carries the Urdu glyph + English label for screen readers, same reasoning as before this control existed. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const options = measurementOptionsFor(fieldKey);

  // Close on a click truly outside this control — a plain input's own
  // onBlur already closes it for Tab-away/focus-elsewhere; this additionally
  // covers a mousedown that lands outside without ever focusing anything.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        inputMode="decimal"
        data-mkey={fieldKey}
        name={name}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onFocus={() => {
          onFocus();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(event) => onChange(sanitizeDecimalKeystroke(value, event.target.value))}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            setOpen(false);
            onEnter();
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={className}
        autoComplete="off"
      />
      {/* Panel surface uses `paper` (the app's warm cream page tone) rather
          than `card` (plain white, same as the input itself) — otherwise
          the panel just reads as a plain white box. Border/shadow/accent
          are still this app's own existing tokens (border-rule, indigo),
          same reasoning as before: reused, not invented. Scrollbar thumb
          is tinted with `rule` (the app's own hairline color) via the
          Webkit pseudo-element classes plus a Firefox-native fallback,
          since the default OS scrollbar otherwise looks out of place. */}
      {open && options.length > 0 && (
        <ul
          role="listbox"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#D8CFC2 transparent" }}
          className="absolute right-0 top-full z-20 mt-1.5 max-h-52 w-full min-w-[5rem] overflow-y-auto rounded-sm border border-rule bg-paper p-1.5 shadow-md [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-rule [&::-webkit-scrollbar-track]:bg-transparent"
        >
          {options.map((option) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                // mousedown, not click/onFocus — fires and applies the
                // selection BEFORE the input's own onBlur would otherwise
                // close this panel; preventDefault stops this button from
                // ever taking focus in the first place, so the input
                // never actually blurs when an option is picked.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(option);
                  setOpen(false);
                }}
                className={`block w-full rounded-sm px-2 py-1 text-right text-sm tabular-nums transition ${
                  option === value
                    ? "bg-indigo/10 font-semibold text-indigo"
                    : "text-graphite hover:bg-card hover:text-indigo"
                }`}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
