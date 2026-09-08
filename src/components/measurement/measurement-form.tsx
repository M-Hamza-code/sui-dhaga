"use client";

// S3-style measurement input (Step 13). Rebuilds the UX only — the
// underlying validation contract is exactly Step 5's saveMeasurement
// upsert rule (measurementInputSchema), untouched. Every decimal field
// renders a visible fraction-glyph display input plus a hidden
// plain-decimal input carrying the real `name`; only the hidden inputs
// are ever submitted, so that contract never changes.
//
// Phase 6 (offline-first) — local-first: submitting no longer posts to
// the saveMeasurement Server Action directly. handleSubmit reads the
// same hidden-input FormData the Server Action always received (via
// `new FormData(event.currentTarget)` — the field names/values are
// identical), then writes it into Dexie + a SAVE_MEASUREMENT queue item
// in ONE atomic transaction (enqueueSaveMeasurement, sync-engine.ts),
// exactly the same pattern order-status-form.tsx (Phase 4) and
// new-customer-form.tsx (Phase 5) already established. saveMeasurement
// itself is completely unchanged and still fully exported/working —
// this form just no longer submits to it directly; the new offline-sync
// Route Handler (/api/sync/measurement) enforces the exact same
// validation rule via the same shared module (measurement-sync.ts).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Measurement } from "@prisma/client";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { enqueueSaveMeasurement, processSyncQueue } from "@/lib/offline/sync-engine";
import { navigateAfterLocalSave } from "@/lib/offline/navigate";
import { toFractionDisplay, fractionDisplayToDecimal } from "@/lib/fractions";
import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { en } from "@/lib/locale";

const SHALWAR_LENGTH = findField("shalwarLength");
const PANCHA = findField("pancha");
const SHALWAR_GHERA_READY = findField("shalwarGheraReady");

// The fixed tailoring sequence Enter/Tab must follow (requirement #7):
// Kameez length -> ... -> hem, then Shalwar length -> pancha -> pocket ->
// finished-hem. Built from the shared field list rather than re-typed.
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

function initialDisplayValues(measurement: Measurement | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of SEQUENCE) {
    if (key === SHALWAR_POCKET_FIELD.key) {
      values[key] = measurement?.shalwarPocket === true ? "yes" : measurement?.shalwarPocket === false ? "no" : "";
    } else {
      const raw = measurement ? (measurement as unknown as Record<string, unknown>)[key] : null;
      values[key] = toFractionDisplay(raw == null ? null : String(raw));
    }
  }
  return values;
}

export function MeasurementForm({
  customerId,
  measurement,
  customerExists,
  error,
}: {
  customerId: string;
  measurement: Measurement | null;
  /** From the server-rendered page's own Prisma read — whether Postgres has a (non-deleted) customer row for this id yet. Phase 6: a customer created offline and not yet synced has none, but may still exist locally (see the mount effect below). */
  customerExists: boolean;
  error?: string;
}) {
  const router = useRouter();

  // The baseline every field's "changed" state is compared against
  // (requirement #6: "the last saved Measurement value"). A plain ref,
  // not state — mutating it doesn't itself trigger a re-render, but the
  // Phase 6 mount effect below always pairs a mutation of it with a
  // setValues() call, which does.
  const original = useRef(initialDisplayValues(measurement));

  const [values, setValues] = useState<Record<string, string>>(() => initialDisplayValues(measurement));
  const [activeField, setActiveField] = useState<string>(SEQUENCE[0]);
  const [noteValue, setNoteValue] = useState(measurement?.note ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notFoundEverywhere, setNotFoundEverywhere] = useState(false);

  // Phase 6 — "local storage is the source of truth" (same principle
  // Phase 5's EditCustomerForm/CustomerIdentityCard already apply): a
  // local measurement row, if one exists, is by definition at least as
  // fresh as what the server rendered (it may be a not-yet-synced
  // offline edit) and wins as the prefill. Also confirms the customer
  // itself exists SOMEWHERE (server or local) before letting the form
  // render at all — a customer created offline that hasn't synced yet
  // has no Postgres row, but does have a local one.
  useEffect(() => {
    let cancelled = false;
    async function preferLocal() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const [localCustomer, localMeasurement] = await Promise.all([
          db.customers.get(customerId),
          db.measurements.where("customerId").equals(customerId).first(),
        ]);
        if (cancelled) return;
        const customerExistsLocally = !!(localCustomer && !localCustomer.deletedAt);
        if (!customerExists && !customerExistsLocally) {
          setNotFoundEverywhere(true);
          return;
        }
        if (localMeasurement) {
          // LocalMeasurement shares the same field names/shapes
          // initialDisplayValues already reads generically (plus the
          // same true/false/null shalwarPocket convention) — reused
          // as-is rather than duplicating that function for this shape.
          const fresh = initialDisplayValues(localMeasurement as unknown as Measurement);
          original.current = fresh;
          setValues(fresh);
          setNoteValue(localMeasurement.note ?? "");
        }
      } catch {
        // Best-effort only — if Dexie can't be read for any reason, the
        // server-provided values (if any) are still shown as-is.
      }
    }
    preferLocal();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    // The exact same field names/values saveMeasurement's FormData
    // parsing has always read — only the hidden decimal inputs and the
    // pocket <select> carry a `name`, so this produces the identical
    // shape regardless of the fraction-glyph display state above it.
    const formData = new FormData(event.currentTarget);
    const result = await enqueueSaveMeasurement(customerId, {
      length: String(formData.get("length") ?? ""),
      shoulder: String(formData.get("shoulder") ?? ""),
      sleeve: String(formData.get("sleeve") ?? ""),
      neck: String(formData.get("neck") ?? ""),
      chest: String(formData.get("chest") ?? ""),
      waist: String(formData.get("waist") ?? ""),
      hem: String(formData.get("hem") ?? ""),
      shalwarLength: String(formData.get("shalwarLength") ?? ""),
      pancha: String(formData.get("pancha") ?? ""),
      shalwarGheraReady: String(formData.get("shalwarGheraReady") ?? ""),
      shalwarPocket: String(formData.get("shalwarPocket") ?? ""),
      note: String(formData.get("note") ?? ""),
    });

    if (!result.queued) {
      setLocalError(result.message ?? "Could not save measurement.");
      setSubmitting(false);
      return;
    }

    // Fire-and-forget, same as new-customer-form.tsx (Phase 5) — the
    // measurement already has a durable local home regardless of
    // whether this succeeds immediately, later, or not at all right now.
    processSyncQueue().catch(() => {});
    // Phase 11 (§10) — see navigate.ts's own comment.
    navigateAfterLocalSave(router, `/customers/${customerId}`);
  }

  useEffect(() => {
    document.querySelector<HTMLInputElement>(`[data-mkey="${SEQUENCE[0]}"]`)?.focus();
  }, []);

  function setFieldValue(key: string, raw: string) {
    // Live fraction normalization: the instant a typed value ends in
    // .5/.25/.75, it becomes ½/¼/¾ — matches the brief's "typing .5 also
    // gives ½".
    setValues((prev) => ({ ...prev, [key]: toFractionDisplay(raw) }));
  }

  function focusField(key: string) {
    document.querySelector<HTMLInputElement>(`[data-mkey="${key}"]`)?.focus();
  }

  function advanceFrom(key: string) {
    const next = SEQUENCE[SEQUENCE.indexOf(key) + 1];
    if (!next) return;
    focusField(next);
    setActiveField(next);
  }

  function applyFraction(glyph: string) {
    if (activeField === SHALWAR_POCKET_FIELD.key) return;
    setValues((prev) => {
      const current = prev[activeField] ?? "";
      const withoutFraction = current.replace(/[½¼¾]/g, "");
      return { ...prev, [activeField]: withoutFraction + glyph };
    });
    focusField(activeField);
  }

  // "Changed" means different from the saved value AND not empty — an
  // in-progress cleared field isn't flagged as a deliberate edit yet,
  // matching the authoritative mockup's own changed-state rule exactly.
  function isChanged(key: string): boolean {
    const current = values[key] ?? "";
    return current !== "" && current !== (original.current[key] ?? "");
  }

  const changedCount = SEQUENCE.filter(isChanged).length;
  const changedNote =
    changedCount === 0 ? en.measurementForm.changedNone
    : changedCount === 1 ? en.measurementForm.changedOne
    : en.measurementForm.changedManyTemplate.replace("{count}", String(changedCount));

  const activeFieldDef =
    activeField === SHALWAR_POCKET_FIELD.key
      ? SHALWAR_POCKET_FIELD
      : [...KAMEEZ_FIELDS, SHALWAR_LENGTH, PANCHA, SHALWAR_GHERA_READY].find((f) => f.key === activeField);

  if (notFoundEverywhere) {
    return (
      <p className="mt-6 rounded-sm border border-dashed border-rule bg-card p-4 text-sm text-graphite/60">
        This customer could not be found, locally or on the server.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
      <div className="rounded-sm border border-rule bg-card p-5 shadow-sm">
        <MeasurementFieldGroup
          title="Kameez"
          fields={KAMEEZ_FIELDS}
          values={values}
          activeField={activeField}
          onFocusField={setActiveField}
          onChangeField={setFieldValue}
          onEnterField={advanceFrom}
          isChanged={isChanged}
        />

        <div className="mt-6">
          <MeasurementFieldGroup
            title="Shalwar"
            fields={[SHALWAR_LENGTH, PANCHA]}
            values={values}
            activeField={activeField}
            onFocusField={setActiveField}
            onChangeField={setFieldValue}
            onEnterField={advanceFrom}
            isChanged={isChanged}
          />
          <div className="mt-1 space-y-1">
            <PocketRow
              value={values[SHALWAR_POCKET_FIELD.key] ?? ""}
              isChanged={isChanged(SHALWAR_POCKET_FIELD.key)}
              onFocus={() => setActiveField(SHALWAR_POCKET_FIELD.key)}
              onChange={(v) => setValues((prev) => ({ ...prev, [SHALWAR_POCKET_FIELD.key]: v }))}
            />
            <MeasurementFieldGroup
              title={null}
              fields={[SHALWAR_GHERA_READY]}
              values={values}
              activeField={activeField}
              onFocusField={setActiveField}
              onChangeField={setFieldValue}
              onEnterField={advanceFrom}
              isChanged={isChanged}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          {FRACTION_KEYS.map((glyph) => (
            <button
              key={glyph}
              type="button"
              disabled={activeField === SHALWAR_POCKET_FIELD.key}
              onClick={() => applyFraction(glyph)}
              className="h-9 w-11 rounded-sm border border-rule bg-paper text-lg text-indigo transition hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
            >
              {glyph}
            </button>
          ))}
          <span className="ml-1 text-xs text-graphite/50">{en.measurementForm.fractionHint}</span>
          <span className="flex-1" />
          <span className={`text-xs ${changedCount > 0 ? "text-amber" : "text-graphite/40"}`}>{changedNote}</span>
        </div>

        <div className="mt-5">
          <label htmlFor="note" className="block text-sm font-medium text-graphite">
            {en.profile.note} <span className="font-normal text-graphite/50">(optional)</span>
          </label>
          <textarea
            id="note"
            name="note"
            rows={2}
            value={noteValue}
            onChange={(event) => setNoteValue(event.target.value)}
            className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
          />
        </div>

        {(localError ?? error) && (
          <p role="alert" className="mt-4 rounded-sm border border-amber bg-amber/10 px-4 py-2 text-sm text-graphite">
            {localError ?? error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-sm bg-indigo px-4 py-2.5 text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2 disabled:opacity-60"
        >
          {submitting ? en.orderForm.saving : en.measurementForm.save}
        </button>
      </div>

      {/* Reference/progress panel only — requirement #8. It never gates
          input; every field above is fully usable with the mouse absent.
          Step 50 — brought to parity with the Order Form's own measurement
          block (order-measurement-block.tsx), which had already gained
          the Step 41 decorative silhouette and Step 49 panel polish that
          this standalone form was still missing: same eyebrow label
          above the box (not inside it), same taller panel, same shadow,
          same static aria-hidden SVG (no fill/interaction — still purely
          decorative, still reference-only). activeFieldDef/the badge are
          the exact same unchanged element/logic that was already here. */}
      <div className="h-fit rounded-sm border border-rule bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink">{en.measurementForm.diagramTitle}</p>
        <div className="relative mt-2 flex min-h-[280px] flex-col items-center justify-center gap-3 overflow-hidden rounded-sm border border-dashed border-rule bg-paper p-5 text-center">
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
    </form>
  );
}

function MeasurementFieldGroup({
  title,
  fields,
  values,
  activeField,
  onFocusField,
  onChangeField,
  onEnterField,
  isChanged,
}: {
  title: string | null;
  fields: readonly { key: string; ur: string; label: string }[];
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
        <legend className="mb-2 border-b border-rule pb-1 text-xs font-semibold uppercase tracking-widest text-ink">
          {title}
        </legend>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {fields.map((field) => (
          <DecimalRow
            key={field.key}
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
      className={`flex items-center gap-2 rounded-sm px-2 py-1.5 ${isActive ? "bg-paper" : ""}`}
      style={isActive ? { boxShadow: "inset 2px 0 0 #1F3A63" } : undefined}
    >
      <span dir="rtl" className="font-naskh min-w-[64px] text-lg leading-tight text-graphite">
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
        className={`w-24 rounded-sm border px-2 py-1 text-right text-xl tabular-nums focus:outline-none ${
          isChanged
            ? "border-amber bg-amber/10 font-semibold text-amber"
            : "border-rule bg-card text-graphite focus:border-indigo"
        }`}
      />
      {/* The only field actually submitted — always a plain decimal
          string, so measurement-actions.ts's existing validation and
          Prisma's Decimal column never see a fraction glyph. */}
      <input type="hidden" name={fieldKey} value={decimalValue} />
    </div>
  );
}

function PocketRow({
  value,
  isChanged,
  onFocus,
  onChange,
}: {
  value: string;
  isChanged: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-sm px-2 py-1.5 ${isChanged ? "bg-amber/10" : ""}`}>
      <span dir="rtl" className="font-naskh min-w-[64px] text-lg leading-tight text-graphite">
        {SHALWAR_POCKET_FIELD.ur}
      </span>
      <span className="hidden text-[10px] uppercase tracking-wide text-graphite/40 sm:inline">
        {SHALWAR_POCKET_FIELD.label}
      </span>
      <span className="flex-1" />
      <select
        data-mkey={SHALWAR_POCKET_FIELD.key}
        name={SHALWAR_POCKET_FIELD.key}
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
