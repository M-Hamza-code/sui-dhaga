"use client";

// Embeddable measurement input block for the S3 Order form (Step 14).
// Reuses the exact Step 13 logic modules — fractions.ts's glyph
// conversion and measurement-fields.ts's field list/Urdu labels — but is
// its own component rather than measurement-form.tsx itself, because the
// order form embeds this block more than once per page (the order-level
// default, plus one per suit that has "different measurements for this
// suit" turned on) with independently scoped Enter/Tab sequences, where
// measurement-form.tsx is a single full-page form tied to one Measurement
// row. The submitted contract is identical either way: a visible
// fraction-glyph display input paired with a hidden plain-decimal input
// carrying the real `name` — order-actions.ts's readMeasurementBlock()
// only ever sees a plain decimal string, never a fraction glyph.

import { useEffect } from "react";
import { toFractionDisplay, fractionDisplayToDecimal } from "@/lib/fractions";
import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { en } from "@/lib/locale";

const SHALWAR_LENGTH = findField("shalwarLength");
const PANCHA = findField("pancha");
const SHALWAR_GHERA_READY = findField("shalwarGheraReady");

const SEQUENCE: string[] = [
  ...KAMEEZ_FIELDS.map((f) => f.key),
  SHALWAR_LENGTH.key,
  PANCHA.key,
  SHALWAR_POCKET_FIELD.key,
  SHALWAR_GHERA_READY.key,
];

const FRACTION_KEYS = ["½", "¼", "¾"] as const;

function findField(key: string) {
  const field = SHALWAR_DECIMAL_FIELDS.find((f) => f.key === key);
  if (!field) throw new Error(`Unknown measurement field: ${key}`);
  return field;
}

export type MeasurementBlockValues = Record<string, string>;

/** All fields blank — the starting state for a per-suit override block. */
export function emptyMeasurementBlockValues(): MeasurementBlockValues {
  const values: MeasurementBlockValues = {};
  for (const key of SEQUENCE) values[key] = "";
  return values;
}

/** Pre-fills from a Measurement-shaped record (or null), display values as fraction glyphs — same rule Step 13's form uses. */
export function measurementBlockValuesFrom(source: Record<string, unknown> | null | undefined): MeasurementBlockValues {
  const values: MeasurementBlockValues = {};
  for (const key of SEQUENCE) {
    if (key === SHALWAR_POCKET_FIELD.key) {
      const raw = source ? source.shalwarPocket : null;
      values[key] = raw === true ? "yes" : raw === false ? "no" : "";
    } else {
      const raw = source ? source[key] : null;
      values[key] = toFractionDisplay(raw == null ? null : String(raw));
    }
  }
  return values;
}

export function OrderMeasurementBlock({
  blockId,
  namePrefix,
  values,
  onChange,
  originalValues,
  activeField,
  onActiveFieldChange,
  showDiagram = false,
  noteValue,
  onNoteChange,
}: {
  /** Unique per-instance id used to scope Enter/Tab focus lookups (querySelector) to just this block. */
  blockId: string;
  /** Form field name prefix, e.g. "default" or "item.2" — matches order-actions.ts's readMeasurementBlock(). */
  namePrefix: string;
  values: MeasurementBlockValues;
  onChange: (key: string, displayValue: string) => void;
  /** Baseline to compare against for the amber "changed" highlight — omit for a block with nothing to compare to (a fresh per-suit override). */
  originalValues?: MeasurementBlockValues;
  activeField: string;
  onActiveFieldChange: (key: string) => void;
  showDiagram?: boolean;
  noteValue?: string;
  onNoteChange?: (value: string) => void;
}) {
  useEffect(() => {
    // Only the very first block on the page should steal initial focus —
    // callers that don't want that simply don't rely on this; there is no
    // autofocus side effect here for later-added override blocks.
  }, []);

  function focusField(key: string) {
    document.querySelector<HTMLInputElement>(`[data-block="${blockId}"] [data-mkey="${key}"]`)?.focus();
  }

  function advanceFrom(key: string) {
    const next = SEQUENCE[SEQUENCE.indexOf(key) + 1];
    if (!next) return;
    focusField(next);
    onActiveFieldChange(next);
  }

  function applyFraction(glyph: string) {
    if (activeField === SHALWAR_POCKET_FIELD.key) return;
    const current = values[activeField] ?? "";
    const withoutFraction = current.replace(/[½¼¾]/g, "");
    onChange(activeField, withoutFraction + glyph);
    focusField(activeField);
  }

  function isChanged(key: string): boolean {
    if (!originalValues) return false;
    const current = values[key] ?? "";
    return current !== "" && current !== (originalValues[key] ?? "");
  }

  const activeFieldDef =
    activeField === SHALWAR_POCKET_FIELD.key
      ? SHALWAR_POCKET_FIELD
      : [...KAMEEZ_FIELDS, SHALWAR_LENGTH, PANCHA, SHALWAR_GHERA_READY].find((f) => f.key === activeField);

  return (
    <div data-block={blockId} className={showDiagram ? "grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]" : ""}>
      <div>
        <FieldGroup
          title={en.orderForm.kameez}
          fields={KAMEEZ_FIELDS}
          namePrefix={namePrefix}
          values={values}
          activeField={activeField}
          onFocusField={onActiveFieldChange}
          onChangeField={onChange}
          onEnterField={advanceFrom}
          isChanged={isChanged}
        />

        <div className="mt-4">
          <FieldGroup
            title={en.orderForm.shalwar}
            fields={[SHALWAR_LENGTH, PANCHA]}
            namePrefix={namePrefix}
            values={values}
            activeField={activeField}
            onFocusField={onActiveFieldChange}
            onChangeField={onChange}
            onEnterField={advanceFrom}
            isChanged={isChanged}
          />
          <div className="mt-1 space-y-1">
            <PocketRow
              namePrefix={namePrefix}
              value={values[SHALWAR_POCKET_FIELD.key] ?? ""}
              isChanged={isChanged(SHALWAR_POCKET_FIELD.key)}
              onFocus={() => onActiveFieldChange(SHALWAR_POCKET_FIELD.key)}
              onChange={(v) => onChange(SHALWAR_POCKET_FIELD.key, v)}
            />
            <FieldGroup
              title={null}
              fields={[SHALWAR_GHERA_READY]}
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

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          {FRACTION_KEYS.map((glyph) => (
            <button
              key={glyph}
              type="button"
              disabled={activeField === SHALWAR_POCKET_FIELD.key}
              onClick={() => applyFraction(glyph)}
              className="h-8 w-10 rounded-sm border border-rule bg-paper text-base text-indigo transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
            >
              {glyph}
            </button>
          ))}
          <span className="text-xs text-graphite/50">{en.measurementForm.fractionHint}</span>
        </div>

        {onNoteChange && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-graphite">
              {en.orderForm.measurementNote} <span className="font-normal text-graphite/50">({en.orderForm.notePlaceholder})</span>
            </label>
            <textarea
              name={`${namePrefix}.note`}
              rows={2}
              value={noteValue ?? ""}
              onChange={(event) => onNoteChange(event.target.value)}
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
          </div>
        )}
      </div>

      {showDiagram && (
        <div className="h-fit rounded-sm border border-rule bg-card p-4 shadow-sm">
          {/* Step 41 — design brief §2: "Signature element: the
              measurement diagram... the one place to spend visual
              ambition." No real illustrated diagram exists in either
              provided reference file — the authoritative mockup's own S3
              section labels this exact element "Body diagram —
              placeholder" and never renders a real illustration either
              (confirmed by inspecting the mockup source directly). This
              adds a quiet, static shalwar-kameez silhouette as a
              backdrop, purely decorative (no fill/interaction, aria-hidden,
              muted graphite-on-paper, existing tokens only) — a safer
              temporary reference than a bare dashed box, matching the
              brief's stated priority for this element, while changing
              nothing about how it works: still reference-only, never an
              input, never gates typing, no click-to-focus added, the
              active-field badge below is the exact same unchanged
              element/logic that was already here. Swapping in a real
              photographed/illustrated diagram later is still just
              replacing this one static SVG — nothing downstream of it
              (activeFieldDef, the badge, the fields on the left) needs to
              change either way.

              Step 49 — same static SVG, same "reference only" behavior;
              only the frame around it got more intentional (an eyebrow
              label above instead of buried inside the dashed box, a
              slightly taller panel, a touch more polish on the active-
              field badge) so this reads as a designed panel rather than a
              leftover placeholder box. */}
          <p className="text-xs font-semibold uppercase tracking-widest text-ink">{en.measurementForm.diagramTitle}</p>
          <div className="relative mt-2 flex min-h-[220px] flex-col items-center justify-center gap-3 overflow-hidden rounded-sm border border-dashed border-rule bg-paper p-5 text-center">
            <svg
              viewBox="0 0 100 180"
              className="absolute inset-0 z-0 h-full w-full p-6 text-graphite/20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M50 8 C44 8 40 12 40 16 L24 26 L18 60 L28 63 L33 34 L33 120 C33 128 38 132 45 132 L55 132 C62 132 67 128 67 120 L67 34 L72 63 L82 60 L76 26 L60 16 C60 12 56 8 50 8 Z" />
              <path d="M40 132 L35 172 C35 176 38 178 42 178 L47 178 L50 145 L53 178 L58 178 C62 178 65 176 65 172 L60 132" />
            </svg>
            {activeFieldDef && (
              <span className="relative z-10 flex items-center gap-2 rounded-sm bg-indigo px-4 py-1.5 text-white shadow-sm">
                <span dir="rtl" className="font-naskh text-lg">
                  {activeFieldDef.ur}
                </span>
                <span className="text-[10px] uppercase tracking-wide opacity-75">{activeFieldDef.label}</span>
              </span>
            )}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-graphite/50">{en.measurementForm.diagramHint}</p>
        </div>
      )}
    </div>
  );
}

function FieldGroup({
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
  title: string | null;
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
      {title && (
        <legend className="mb-1.5 border-b border-rule pb-1 text-xs font-semibold uppercase tracking-widest text-ink">
          {title}
        </legend>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {fields.map((field) => (
          <DecimalRow
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

function DecimalRow({
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
  const decimalValue = fractionDisplayToDecimal(value);

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
      <input
        type="text"
        inputMode="decimal"
        data-mkey={fieldKey}
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEnter();
          }
        }}
        className={`w-20 rounded-sm border px-2 py-1 text-right text-lg tabular-nums focus:outline-none ${
          isChanged
            ? "border-amber bg-amber/10 font-semibold text-amber"
            : "border-rule bg-card text-graphite focus:border-indigo"
        }`}
      />
      {/* Only field actually submitted — always a plain decimal string. */}
      <input type="hidden" name={`${namePrefix}.${fieldKey}`} value={decimalValue} />
    </div>
  );
}

function PocketRow({
  namePrefix,
  value,
  isChanged,
  onFocus,
  onChange,
}: {
  namePrefix: string;
  value: string;
  isChanged: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-sm px-2 py-1.5 ${isChanged ? "bg-amber/10" : ""}`}>
      <span dir="rtl" className="font-naskh min-w-[56px] text-base leading-tight text-graphite">
        {SHALWAR_POCKET_FIELD.ur}
      </span>
      <span className="hidden text-[10px] uppercase tracking-wide text-graphite/40 sm:inline">
        {SHALWAR_POCKET_FIELD.label}
      </span>
      <span className="flex-1" />
      <select
        data-mkey={SHALWAR_POCKET_FIELD.key}
        name={`${namePrefix}.${SHALWAR_POCKET_FIELD.key}`}
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-sm border px-2 py-1 text-sm focus:outline-none ${
          isChanged ? "border-amber bg-amber/10 text-amber" : "border-rule bg-card text-graphite focus:border-indigo"
        }`}
      >
        <option value="">{en.measurementForm.notSpecified}</option>
        <option value="yes">{en.profile.yes}</option>
        <option value="no">{en.profile.no}</option>
      </select>
    </div>
  );
}
