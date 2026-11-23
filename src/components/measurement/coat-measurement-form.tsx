"use client";

// Standalone Prince Coat/Waistcoat measurement form — the Coat-mode
// sibling of measurement-form.tsx, same architecture (local-first via
// Dexie + sync queue, autosave draft, "no draft until a saved profile
// exists" gating — see that component's own comments for the full
// reasoning behind each of these, mirrored here verbatim). Plain numeric
// inputs only (CoatDecimalField, no dropdown), per the explicit
// requirement for Coat/Waistcoat fields.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CoatMeasurement } from "@prisma/client";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { enqueueSaveCoatMeasurement, processSyncQueue } from "@/lib/offline/sync-engine";
import { navigateAfterLocalSave } from "@/lib/offline/navigate";
import {
  loadCoatMeasurementDraft,
  saveCoatMeasurementDraft,
  clearCoatMeasurementDraft,
} from "@/lib/coat-measurement-draft-storage";
import { COAT_FIELDS, WAISTCOAT_FIELDS, ALL_COAT_FIELD_KEYS } from "@/lib/coat-measurement-fields";
import { CoatDecimalField } from "@/components/measurement/coat-decimal-field";
import { en } from "@/lib/locale";

function initialDisplayValues(measurement: CoatMeasurement | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ALL_COAT_FIELD_KEYS) {
    const raw = measurement ? (measurement as unknown as Record<string, unknown>)[key] : null;
    values[key] = raw == null ? "" : String(raw);
  }
  return values;
}

export function CoatMeasurementForm({
  customerId,
  measurement,
  customerExists,
  error,
}: {
  customerId: string;
  measurement: CoatMeasurement | null;
  customerExists: boolean;
  error?: string;
}) {
  const router = useRouter();

  const original = useRef(initialDisplayValues(measurement));
  const [values, setValues] = useState<Record<string, string>>(() => initialDisplayValues(measurement));
  const [activeField, setActiveField] = useState<string>(ALL_COAT_FIELD_KEYS[0]);
  const [noteValue, setNoteValue] = useState(measurement?.note ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notFoundEverywhere, setNotFoundEverywhere] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const touched = useRef(false);
  // See measurement-form.tsx's own comment on this exact gate — a
  // customer with no saved Coat profile yet never gets a draft persisted
  // or restored, so a refresh before saving returns to a genuinely empty
  // form.
  const hasSavedMeasurement = useRef(measurement != null);

  useEffect(() => {
    let cancelled = false;
    async function preferLocal() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const [localCustomer, localMeasurement] = await Promise.all([
          db.customers.get(customerId),
          db.coatMeasurements.where("customerId").equals(customerId).first(),
        ]);
        if (cancelled) return;
        const customerExistsLocally = !!(localCustomer && !localCustomer.deletedAt);
        if (!customerExists && !customerExistsLocally) {
          setNotFoundEverywhere(true);
          return;
        }
        if (localMeasurement) {
          const fresh = initialDisplayValues(localMeasurement as unknown as CoatMeasurement);
          original.current = fresh;
          setValues(fresh);
          setNoteValue(localMeasurement.note ?? "");
          hasSavedMeasurement.current = true;
        }
        if (hasSavedMeasurement.current) {
          applyDraft();
        }
      } catch {
        // Best-effort only.
      }
    }
    preferLocal();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  function applyDraft() {
    const draft = loadCoatMeasurementDraft(customerId);
    if (!draft) return;
    touched.current = true;
    setValues((prev) => ({ ...prev, ...draft.values }));
    setNoteValue(draft.note);
    setRestoredDraft(true);
  }

  function discardDraft() {
    clearCoatMeasurementDraft(customerId);
    touched.current = false;
    setValues(original.current);
    setNoteValue(measurement?.note ?? "");
    setRestoredDraft(false);
  }

  useEffect(() => {
    if (!touched.current) return;
    if (!hasSavedMeasurement.current) return;

    const dirty =
      noteValue !== (measurement?.note ?? "") || ALL_COAT_FIELD_KEYS.some((key) => (values[key] ?? "") !== (original.current[key] ?? ""));

    const timer = setTimeout(() => {
      if (dirty) {
        saveCoatMeasurementDraft(customerId, { values, note: noteValue });
      } else {
        clearCoatMeasurementDraft(customerId);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [values, noteValue, customerId, measurement?.note]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const input: Record<string, string> & { note: string } = { note: String(formData.get("note") ?? "") };
    for (const key of ALL_COAT_FIELD_KEYS) {
      input[key] = String(formData.get(key) ?? "");
    }
    const result = await enqueueSaveCoatMeasurement(customerId, input);

    if (!result.queued) {
      setLocalError(result.message ?? "Could not save measurement.");
      setSubmitting(false);
      return;
    }

    clearCoatMeasurementDraft(customerId);
    processSyncQueue().catch(() => {});
    navigateAfterLocalSave(router, `/customers/${customerId}`);
  }

  function setFieldValue(key: string, value: string) {
    touched.current = true;
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function isChanged(key: string): boolean {
    const current = values[key] ?? "";
    return current !== "" && current !== (original.current[key] ?? "");
  }

  if (notFoundEverywhere) {
    return (
      <p className="mt-6 rounded-sm border border-dashed border-rule bg-card p-4 text-sm text-graphite/60">
        This customer could not be found, locally or on the server.
      </p>
    );
  }

  return (
    <>
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

      <form onSubmit={handleSubmit} className="mt-6 rounded-sm border border-rule bg-card p-5 shadow-sm">
        <CoatFieldGroup
          title={en.orderForm.princeCoatMeasurements}
          fields={COAT_FIELDS}
          values={values}
          activeField={activeField}
          onFocusField={setActiveField}
          onChangeField={setFieldValue}
          isChanged={isChanged}
        />
        <div className="mt-6">
          <CoatFieldGroup
            title={en.orderForm.waistcoatMeasurements}
            fields={WAISTCOAT_FIELDS}
            values={values}
            activeField={activeField}
            onFocusField={setActiveField}
            onChangeField={setFieldValue}
            isChanged={isChanged}
          />
        </div>

        <div className="mt-5">
          <label htmlFor="coat-note" className="block text-sm font-medium text-graphite">
            {en.profile.note} <span className="font-normal text-graphite/50">(optional)</span>
          </label>
          <textarea
            id="coat-note"
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
      </form>
    </>
  );
}

function CoatFieldGroup({
  title,
  fields,
  values,
  activeField,
  onFocusField,
  onChangeField,
  isChanged,
}: {
  title: string;
  fields: readonly { key: string; ur: string; label: string }[];
  values: Record<string, string>;
  activeField: string;
  onFocusField: (key: string) => void;
  onChangeField: (key: string, value: string) => void;
  isChanged: (key: string) => boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-2 border-b border-rule pb-1 text-xs font-semibold uppercase tracking-widest text-ink">{title}</legend>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.key}
            className={`flex items-center gap-2 rounded-sm px-2 py-1.5 ${activeField === field.key ? "bg-paper" : ""}`}
            style={activeField === field.key ? { boxShadow: "inset 2px 0 0 #1F3A63" } : undefined}
          >
            <span dir="rtl" className="font-naskh min-w-[64px] text-lg leading-tight text-graphite">
              {field.ur}
            </span>
            <span className="hidden text-[10px] uppercase tracking-wide text-graphite/40 sm:inline">{field.label}</span>
            <span className="flex-1" />
            <CoatDecimalField
              fieldKey={field.key}
              name={field.key}
              value={values[field.key] ?? ""}
              placeholder={en.measurementForm.notSpecified}
              onFocus={() => onFocusField(field.key)}
              onChange={(v) => onChangeField(field.key, v)}
              onEnter={() => {}}
              ariaLabel={`${field.label} (${field.ur})`}
              className={`w-24 rounded-sm border px-2 py-1 text-right text-xl tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo ${
                isChanged(field.key)
                  ? "border-amber bg-amber/10 font-semibold text-amber"
                  : "border-rule bg-card text-graphite focus:border-indigo"
              }`}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
