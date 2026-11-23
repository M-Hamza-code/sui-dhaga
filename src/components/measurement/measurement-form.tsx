"use client";

// S3-style measurement input (Step 13; Upgrade 1 replaced free-text +
// fraction-glyph entry with predefined-value dropdowns — see
// measurement-options.ts and measurement-decimal-field.tsx for the final
// control: a real text input paired with an app-styled dropdown panel,
// not a native <select>/<datalist> — see that component's own comment
// for why). The underlying validation contract is exactly Step 5's
// saveMeasurement upsert rule (measurementInputSchema), untouched. Every
// decimal field's own value IS the plain decimal string submitted under
// its real `name` — no separate display/hidden-input pair is needed,
// since there's no display format that differs from what's submitted.
//
// Phase 6 (offline-first) — local-first: submitting no longer posts to
// the saveMeasurement Server Action directly. handleSubmit reads the
// same FormData the Server Action always received (via
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
import {
  loadMeasurementDraft,
  saveMeasurementDraft,
  clearMeasurementDraft,
} from "@/lib/measurement-draft-storage";
import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { MeasurementDecimalField } from "@/components/measurement/measurement-decimal-field";
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

function findField(key: string) {
  const field = SHALWAR_DECIMAL_FIELDS.find((f) => f.key === key);
  if (!field) throw new Error(`Unknown measurement field: ${key}`);
  return field;
}

// Upgrade 1 — predefined-value dropdowns replaced the old free-text +
// fraction-glyph entry, so this now stores the PLAIN decimal value
// directly (e.g. "44.5", not "44½") for every decimal field — exactly
// what each field's <select> uses as its own value, and exactly what's
// submitted (the <select>'s own `name` carries it; no hidden input is
// needed anymore). "" means "not specified", same convention
// shalwarPocket's select already used.
function initialDisplayValues(measurement: Measurement | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of SEQUENCE) {
    if (key === SHALWAR_POCKET_FIELD.key) {
      values[key] = measurement?.shalwarPocket === true ? "yes" : measurement?.shalwarPocket === false ? "no" : "";
    } else {
      const raw = measurement ? (measurement as unknown as Record<string, unknown>)[key] : null;
      values[key] = raw == null ? "" : String(raw);
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
  // True once an unsaved draft has been restored into the form, so the
  // user is told rather than silently shown values they don't recognise
  // as "saved".
  const [restoredDraft, setRestoredDraft] = useState(false);
  // Gates autosave. Without it, mounting the form would immediately
  // persist the untouched prefill as a "draft", and every later visit
  // would claim to have restored unsaved work that never existed.
  const touched = useRef(false);

  // Gates the draft entirely (both reading and writing it). True only once
  // a REAL saved Measurement row exists for this customer — either the
  // server-rendered `measurement` prop, or a local Dexie row found by the
  // mount effect below. A customer with no saved measurement yet (the
  // "new customer" / first-time-entry case, including one created offline
  // and not yet synced) never gets a draft persisted or restored: a
  // refresh before saving must return to a genuinely empty form, not
  // resurrect what was typed. A customer who already has a saved
  // measurement keeps full autosave/restore exactly as before — this only
  // narrows the no-measurement-yet case, it doesn't touch editing.
  const hasSavedMeasurement = useRef(measurement != null);

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
          hasSavedMeasurement.current = true;
        }

        // LAST, so it wins over both the server prefill and the local
        // Dexie row above: an unsaved draft is by definition the most
        // recent thing the user typed. Deliberately does NOT move
        // `original.current` — that stays the last SAVED baseline, so
        // restored-but-unsaved fields keep showing the amber "changed"
        // treatment and the change count stays truthful. Skipped entirely
        // when there's no saved measurement yet — see hasSavedMeasurement.
        if (hasSavedMeasurement.current) {
          applyDraft();
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

  // Restore an autosaved draft, if this customer has one. Called at the
  // end of the mount effect above (and nowhere else) so it always lands
  // after the server/Dexie prefill rather than racing it.
  function applyDraft() {
    const draft = loadMeasurementDraft(customerId);
    if (!draft) return;
    touched.current = true;
    setValues((prev) => ({ ...prev, ...draft.values }));
    setNoteValue(draft.note);
    setRestoredDraft(true);
  }

  // Throw the draft away and go back to whatever is actually saved.
  function discardDraft() {
    clearMeasurementDraft(customerId);
    touched.current = false;
    setValues(original.current);
    setNoteValue(measurement?.note ?? "");
    setRestoredDraft(false);
  }

  // Autosave, debounced the same 1500ms the order form uses. Only ever
  // writes once the user has actually edited something (`touched`) —
  // otherwise opening the form would persist the untouched prefill and
  // every later visit would claim to restore work that was never done.
  // When the form is edited back to matching the saved values there is
  // nothing worth keeping, so the draft is removed instead of stored.
  useEffect(() => {
    if (!touched.current) return;
    // No saved measurement yet for this customer: never persist a draft,
    // so there is nothing left to restore on a refresh (see
    // hasSavedMeasurement's own comment).
    if (!hasSavedMeasurement.current) return;

    const dirty =
      noteValue !== (measurement?.note ?? "") ||
      SEQUENCE.some((key) => (values[key] ?? "") !== (original.current[key] ?? ""));

    const timer = setTimeout(() => {
      if (dirty) {
        saveMeasurementDraft(customerId, { values, note: noteValue });
      } else {
        clearMeasurementDraft(customerId);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [values, noteValue, customerId, measurement?.note]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    // The exact same field names/values saveMeasurement's FormData
    // parsing has always read — every decimal field's <select> and the
    // pocket <select> all carry a real `name`, so this produces the
    // identical shape it always has.
    const formData = new FormData(event.currentTarget);
    const result = await enqueueSaveMeasurement(customerId, {
      length: String(formData.get("length") ?? ""),
      shoulder: String(formData.get("shoulder") ?? ""),
      sleeve: String(formData.get("sleeve") ?? ""),
      armHole: String(formData.get("armHole") ?? ""),
      kohni: String(formData.get("kohni") ?? ""),
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

    // The values now live in Dexie + the sync queue, so the localStorage
    // draft has nothing left to protect — dropped here (not on navigate)
    // so a draft can never outlive the save it was covering for.
    clearMeasurementDraft(customerId);

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

  function setFieldValue(key: string, decimalValue: string) {
    touched.current = true;
    // decimalValue is already the exact plain-decimal <option> value the
    // user picked — no conversion needed (Upgrade 1).
    setValues((prev) => ({ ...prev, [key]: decimalValue }));
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
    <>
      {/* Shown only when an autosaved draft was actually restored into
          the form (measurement-draft-storage.ts). Without this the user
          would see values that differ from what's saved with no
          explanation — worse than losing them, because they might trust
          them as saved. Amber is the app's existing "needs attention"
          tone, the same one the changed-field highlighting uses. */}
      {restoredDraft && (
        <div
          role="status"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber bg-amber/10 px-4 py-2.5"
        >
          <p className="text-sm text-graphite">{en.measurementForm.draftRestored}</p>
          <button
            type="button"
            onClick={discardDraft}
            className="rounded-sm border border-amber px-3 py-1.5 text-sm text-graphite transition hover:bg-amber/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1"
          >
            {en.measurementForm.draftDiscard}
          </button>
        </div>
      )}

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
              onChange={(v) => {
                touched.current = true;
                setValues((prev) => ({ ...prev, [SHALWAR_POCKET_FIELD.key]: v }));
              }}
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
            onChange={(event) => {
              touched.current = true;
              setNoteValue(event.target.value);
            }}
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
    </>
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
  // Upgrade 1 (second revision) — MeasurementDecimalField is a real text
  // input paired with an app-styled dropdown panel this component itself
  // renders (not a native <select>, which can't accept typed custom
  // values at all, and not a native <datalist>, whose popup is rendered
  // by browser chrome rather than this app's own styling).
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
      <MeasurementDecimalField
        fieldKey={fieldKey}
        name={fieldKey}
        value={value}
        placeholder={en.measurementForm.notSpecified}
        ariaLabel={`${label} (${ur})`}
        onFocus={onFocus}
        onChange={onChange}
        onEnter={onEnter}
        className={`w-24 rounded-sm border px-2 py-1 text-right text-xl tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo ${
          isChanged
            ? "border-amber bg-amber/10 font-semibold text-amber"
            : "border-rule bg-card text-graphite focus:border-indigo"
        }`}
      />
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
      {/* Same unnamed-control problem as DecimalRow's input, same fix,
          from the same two already-rendered strings. */}
      <select
        data-mkey={SHALWAR_POCKET_FIELD.key}
        name={SHALWAR_POCKET_FIELD.key}
        aria-label={`${SHALWAR_POCKET_FIELD.label} (${SHALWAR_POCKET_FIELD.ur})`}
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-sm border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo ${
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
