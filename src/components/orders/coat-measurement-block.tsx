"use client";

// Embeddable Prince Coat/Waistcoat measurement input block for the Order
// form — the Coat-mode sibling of order-measurement-block.tsx's
// OrderMeasurementBlock, same structure (field groups, Enter/Tab sequence,
// amber "changed" highlight), but using CoatDecimalField (plain numeric
// input, no dropdown — per explicit requirement) instead of
// MeasurementDecimalField, and COAT_FIELDS/WAISTCOAT_FIELDS instead of
// KAMEEZ_FIELDS/SHALWAR_DECIMAL_FIELDS. Kept as its own component rather
// than folded into OrderMeasurementBlock via a mode flag — the two field
// sets, label sources, and input controls are different enough that a
// shared component would mostly be a pile of conditionals.

import { COAT_FIELDS, WAISTCOAT_FIELDS } from "@/lib/coat-measurement-fields";
import { CoatDecimalField } from "@/components/measurement/coat-decimal-field";
import { en } from "@/lib/locale";

const SEQUENCE: string[] = [...COAT_FIELDS.map((f) => f.key), ...WAISTCOAT_FIELDS.map((f) => f.key)];

export type CoatMeasurementBlockValues = Record<string, string>;

export function emptyCoatMeasurementBlockValues(): CoatMeasurementBlockValues {
  const values: CoatMeasurementBlockValues = {};
  for (const key of SEQUENCE) values[key] = "";
  return values;
}

export function coatMeasurementBlockValuesFrom(source: Record<string, unknown> | null | undefined): CoatMeasurementBlockValues {
  const values: CoatMeasurementBlockValues = {};
  for (const key of SEQUENCE) {
    const raw = source ? source[key] : null;
    values[key] = raw == null ? "" : String(raw);
  }
  return values;
}

export function CoatMeasurementBlock({
  blockId,
  namePrefix,
  values,
  onChange,
  originalValues,
  activeField,
  onActiveFieldChange,
  visibleGroup = "BOTH",
}: {
  blockId: string;
  /** Form field name prefix, e.g. "default" or "item.2" — matches order-actions.ts's readCoatMeasurementBlock(). */
  namePrefix: string;
  values: CoatMeasurementBlockValues;
  onChange: (key: string, value: string) => void;
  originalValues?: CoatMeasurementBlockValues;
  activeField: string;
  onActiveFieldChange: (key: string) => void;
  /**
   * Explicit garment selection upgrade — "show... measurements following
   * the selected option" (requirement 2): only the field group(s)
   * actually relevant are visually shown. Deliberately a CSS-hide (see
   * below), never a conditional-JSX removal: unmounting the "wrong"
   * group's inputs would drop them from this entry's own FormData the
   * moment it's submitted, silently discarding anything already typed
   * into that group the instant the admin switches selection — exactly
   * the data loss requirement 2 explicitly forbids. Hidden fields stay
   * mounted, controlled, and included in a real submit; they are just
   * not currently relevant to pricing or to this entry's current order.
   */
  visibleGroup?: "PRINCE_COAT" | "WAISTCOAT" | "BOTH";
}) {
  function focusField(key: string) {
    document.querySelector<HTMLInputElement>(`[data-coat-block="${blockId}"] [data-ckey="${key}"]`)?.focus();
  }

  function advanceFrom(key: string) {
    const next = SEQUENCE[SEQUENCE.indexOf(key) + 1];
    if (!next) return;
    focusField(next);
    onActiveFieldChange(next);
  }

  function isChanged(key: string): boolean {
    if (!originalValues) return false;
    const current = values[key] ?? "";
    return current !== "" && current !== (originalValues[key] ?? "");
  }

  return (
    <div data-coat-block={blockId}>
      <div className={visibleGroup === "WAISTCOAT" ? "hidden" : undefined}>
        <CoatFieldGroup
          title={en.orderForm.princeCoatMeasurements}
          fields={COAT_FIELDS}
          namePrefix={namePrefix}
          values={values}
          activeField={activeField}
          onFocusField={onActiveFieldChange}
          onChangeField={onChange}
          onEnterField={advanceFrom}
          isChanged={isChanged}
        />
      </div>
      <div className={`mt-4 ${visibleGroup === "PRINCE_COAT" ? "hidden" : ""}`}>
        <CoatFieldGroup
          title={en.orderForm.waistcoatMeasurements}
          fields={WAISTCOAT_FIELDS}
          namePrefix={namePrefix}
          values={values}
          activeField={activeField}
          onFocusField={onActiveFieldChange}
          onChangeField={onChange}
          onEnterField={advanceFrom}
          isChanged={isChanged}
        />
      </div>
    </div>
  );
}

function CoatFieldGroup({
  title,
  fields,
  namePrefix,
  values,
  activeField,
  onFocusField,
  onChangeField,
  onEnterField,
  isChanged,
}: {
  title: string;
  fields: readonly { key: string; ur: string; label: string }[];
  namePrefix: string;
  values: Record<string, string>;
  activeField: string;
  onFocusField: (key: string) => void;
  onChangeField: (key: string, value: string) => void;
  onEnterField: (key: string) => void;
  isChanged: (key: string) => boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 border-b border-rule pb-1 text-xs font-semibold uppercase tracking-widest text-ink">{title}</legend>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {fields.map((field) => (
          <CoatDecimalRow
            key={field.key}
            namePrefix={namePrefix}
            fieldKey={field.key}
            ur={field.ur}
            label={field.label}
            value={values[field.key] ?? ""}
            isActive={activeField === field.key}
            isChanged={isChanged(field.key)}
            onFocus={() => onFocusField(field.key)}
            onChange={(v) => onChangeField(field.key, v)}
            onEnter={() => onEnterField(field.key)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function CoatDecimalRow({
  namePrefix,
  fieldKey,
  ur,
  label,
  value,
  isActive,
  isChanged,
  onFocus,
  onChange,
  onEnter,
}: {
  namePrefix: string;
  fieldKey: string;
  ur: string;
  label: string;
  value: string;
  isActive: boolean;
  isChanged: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors ${isActive ? "bg-paper" : ""}`}
      style={isActive ? { boxShadow: "inset 2px 0 0 #1F3A63" } : undefined}
    >
      <span dir="rtl" className="font-naskh min-w-[56px] text-base leading-tight text-graphite">
        {ur}
      </span>
      <span className="hidden text-[10px] uppercase tracking-wide text-graphite/40 sm:inline">{label}</span>
      <span className="flex-1" />
      <CoatDecimalField
        fieldKey={fieldKey}
        name={`${namePrefix}.${fieldKey}`}
        value={value}
        placeholder={en.measurementForm.notSpecified}
        onFocus={onFocus}
        onChange={onChange}
        onEnter={onEnter}
        ariaLabel={`${label} (${ur})`}
        className={`w-20 rounded-sm border px-2 py-1 text-right text-lg tabular-nums focus:outline-none ${
          isChanged
            ? "border-amber bg-amber/10 font-semibold text-amber"
            : "border-rule bg-card text-graphite focus:border-indigo"
        }`}
      />
    </div>
  );
}
