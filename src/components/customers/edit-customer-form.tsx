"use client";

// Phase 5 (offline-first) — the customer edit form, extracted out of
// /customers/[customerId]/edit/page.tsx into its own client component,
// same pattern as new-customer-form.tsx.
//
// "Local storage is the source of truth" applies here too: on mount,
// this checks the local Dexie mirror for this customer FIRST — if a
// local row exists (regardless of its own sync state), its values win
// over whatever the server-rendered page passed in, because a pending
// local edit is by definition newer than the last server read. This
// also covers the customer-created-offline-and-not-yet-synced case: the
// server-rendered page finds nothing in Postgres for that id yet, but
// the local row exists, so editing still works immediately.
//
// Submitting writes the edit into Dexie + a queued UPDATE_CUSTOMER item
// in ONE atomic transaction (enqueueUpdateCustomer, sync-engine.ts),
// then navigates straight back to the profile page — the exact same
// destination updateCustomer's own redirect always used. updateCustomer
// (customer-actions.ts) itself is completely unchanged; this form no
// longer submits to it directly, but the new offline-sync Route Handler
// enforces the exact same validation rule via the shared customer-sync.ts
// module.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput } from "@/components/ui/phone-input";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { enqueueUpdateCustomer, processSyncQueue } from "@/lib/offline/sync-engine";
import { navigateAfterLocalSave } from "@/lib/offline/navigate";
import { en } from "@/lib/locale";

const INPUT_CLASS =
  "mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo";

export interface EditCustomerInitialValues {
  name: string;
  phonePrimary: string;
  phoneSecondary: string;
  address: string;
  customerCode: string | null;
}

export function EditCustomerForm({
  customerId,
  serverCustomer,
}: {
  customerId: string;
  /** From the server-rendered page's own Prisma read — null if Postgres has no row for this id yet (e.g. still-unsynced offline create). */
  serverCustomer: EditCustomerInitialValues | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EditCustomerInitialValues | null>(serverCustomer);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function preferLocal() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const local = await db.customers.get(customerId);
        if (cancelled) return;
        if (local && !local.deletedAt) {
          setValues({
            name: local.name,
            phonePrimary: local.phonePrimary,
            phoneSecondary: local.phoneSecondary ?? "",
            address: local.address ?? "",
            customerCode: local.customerCode,
          });
          setNotFound(false);
        } else if (!local && !serverCustomer) {
          setNotFound(true);
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
    if (!values) return;
    setError(null);
    setSubmitting(true);

    const result = await enqueueUpdateCustomer(customerId, values);
    if (!result.queued) {
      setError(result.message ?? "Could not save changes.");
      setSubmitting(false);
      return;
    }

    processSyncQueue().catch(() => {});
    // Phase 11 (§10) — see navigate.ts's own comment.
    navigateAfterLocalSave(router, `/customers/${customerId}`);
  }

  if (notFound) {
    return (
      <p className="mt-6 rounded-sm border border-dashed border-rule bg-card p-4 text-sm text-graphite/60">
        This customer could not be found, locally or on the server.
      </p>
    );
  }

  if (!values) {
    return null;
  }

  return (
    <>
      {/* Phase 10 (§4) — "Customer ID: SD-000123 (cannot be changed)"
          reads fine once a real code exists, but applying the same
          "(cannot be changed)" template to "Pending sync…" doesn't —
          this customer just hasn't reached the server yet, phrased the
          same reassuring way CustomerIdentityCard's own badge already
          does, not as an awkward fragment of the synced-customer copy. */}
      <p className="mt-1 text-sm text-graphite/60">
        {values.customerCode
          ? en.customerForm.editSubtitleTemplate.replace("{code}", values.customerCode)
          : "Saved on this device — customer ID will be assigned once this reaches the server."}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-sm border border-rule bg-card p-6 shadow-sm">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-graphite">
            {en.customerForm.name}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={values.name}
            onChange={(e) => setValues((v) => (v ? { ...v, name: e.target.value } : v))}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="phonePrimary" className="block text-sm font-medium text-graphite">
            {en.customerForm.phonePrimary}
          </label>
          <PhoneInput
            id="phonePrimary"
            name="phonePrimary"
            required
            value={values.phonePrimary}
            onChange={(e) => setValues((v) => (v ? { ...v, phonePrimary: e.target.value } : v))}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="phoneSecondary" className="block text-sm font-medium text-graphite">
            {en.customerForm.phoneSecondary} <span className="font-normal text-graphite/50">({en.customerForm.optional})</span>
          </label>
          <PhoneInput
            id="phoneSecondary"
            name="phoneSecondary"
            value={values.phoneSecondary}
            onChange={(e) => setValues((v) => (v ? { ...v, phoneSecondary: e.target.value } : v))}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-graphite">
            {en.customerForm.address} <span className="font-normal text-graphite/50">({en.customerForm.optional})</span>
          </label>
          <textarea
            id="address"
            name="address"
            rows={3}
            value={values.address}
            onChange={(e) => setValues((v) => (v ? { ...v, address: e.target.value } : v))}
            className={INPUT_CLASS}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-sm border border-amber bg-amber/10 px-3 py-2 text-sm text-graphite">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-sm bg-indigo px-4 py-2.5 text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2 disabled:opacity-60"
        >
          {submitting ? en.orderForm.saving : en.customerForm.editSubmit}
        </button>
      </form>
    </>
  );
}
