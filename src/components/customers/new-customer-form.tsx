"use client";

// Phase 5 (offline-first) — the "Add Customer" flow's form, extracted
// out of /customers/new/page.tsx (which stays a thin Server Component:
// PageHeader, heading, PageContainer — all unchanged) into its own
// client component, exactly the same pattern order-status-form.tsx
// already established in Phase 4.
//
// Local-first: submitting no longer posts to the createCustomer Server
// Action at all — it writes the customer into Dexie (permanent
// crypto.randomUUID() id, customerCode: null) and a CREATE_CUSTOMER
// queue item, in ONE atomic transaction (enqueueCreateCustomer,
// sync-engine.ts), THEN navigates straight to the new customer's profile
// — the exact same destination createCustomer's own redirect always
// used (`/customers/${customerId}`). The user never waits for a server
// round trip to see their new customer.
//
// createCustomer (customer-actions.ts) itself is completely unchanged
// and still fully exported/working — this form just no longer submits
// to it directly. The new offline-sync Route Handler
// (/api/sync/customer-create) enforces the exact same validation rule
// (customerInputSchema) and the exact same customerCode generation
// (generateCustomerCode) via the shared customer-sync.ts module.
//
// Field names/ids/required/optional-suffix copy are all unchanged from
// the previous Server-Action-bound form — only the submission mechanism
// changed.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput } from "@/components/ui/phone-input";
import { enqueueCreateCustomer, processSyncQueue } from "@/lib/offline/sync-engine";
import { navigateAfterLocalSave } from "@/lib/offline/navigate";
import { en } from "@/lib/locale";

const INPUT_CLASS =
  "mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo";

export function NewCustomerForm() {
  const router = useRouter();
  const [values, setValues] = useState({ name: "", phonePrimary: "", phoneSecondary: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await enqueueCreateCustomer(values);
    if (!result.queued || !result.id) {
      setError(result.message ?? "Could not save customer.");
      setSubmitting(false);
      return;
    }

    // Fire-and-forget: the customer already has a durable local home
    // regardless of whether this succeeds immediately, later, or not at
    // all right now — the user is never made to wait for it.
    processSyncQueue().catch(() => {});
    // Phase 11 (§10) — a real navigation when offline, so the existing
    // Service Worker fallback (Phase 8) reliably takes over instead of
    // an unpredictable client-side routing failure; router.push exactly
    // as before when online. See navigate.ts's own comment.
    navigateAfterLocalSave(router, `/customers/${result.id}`);
  }

  return (
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
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
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
          onChange={(e) => setValues((v) => ({ ...v, phonePrimary: e.target.value }))}
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
          onChange={(e) => setValues((v) => ({ ...v, phoneSecondary: e.target.value }))}
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
          onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))}
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
        {submitting ? en.orderForm.saving : en.customerForm.newSubmit}
      </button>
    </form>
  );
}
