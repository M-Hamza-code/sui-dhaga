"use client";

// Plain numeric input for Prince Coat/Waistcoat measurement fields — NO
// dropdown/predefined suggestions, per explicit requirement (these are
// simple numerical inputs, unlike MeasurementDecimalField's Kameez/Shalwar
// dropdown+free-typing control). Reuses that component's exact numbers-only
// keystroke rule (sanitizeDecimalKeystroke, measurement-options.ts) so Coat
// fields can never accept something a Kameez field would reject, or vice
// versa — same custom-typing requirements (multi-digit, decimals, never
// auto-appending anything), just without the suggestion panel.
import { sanitizeDecimalKeystroke } from "@/lib/measurement-options";

export function CoatDecimalField({
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
  /** Used only for the data-ckey DOM attribute — lets a parent block's own Enter/Tab sequence find this input via querySelector, same role MeasurementDecimalField's data-mkey plays. */
  fieldKey: string;
  name: string;
  value: string;
  placeholder: string;
  onFocus: () => void;
  onChange: (value: string) => void;
  onEnter: () => void;
  className: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      data-ckey={fieldKey}
      name={name}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onFocus={onFocus}
      onChange={(event) => onChange(sanitizeDecimalKeystroke(value, event.target.value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter();
        }
      }}
      className={className}
      autoComplete="off"
    />
  );
}
