"use client";

// S3 Order form (Step 14 rebuild). One continuous scrolling page — NOT a
// wizard (design brief §6): measurements, then styles, then money.
//
// Multi-suit support follows the Step 9 schema exactly: a single
// order-level default measurement block (pre-filled from the customer's
// saved Measurement, editable — the values actually used are what get
// frozen into Order.defaultMeasurementSnapshot on save) plus, per suit, an
// optional "different measurements for this suit" override block that
// becomes that OrderItem's own MeasurementSnapshot. Style selections
// (suit type, collar, bain, cuff, pocket, ghera) are shared once per
// order, matching the design brief's style-block table — Patti/Placket is
// not part of that table and is not collected here.
//
// Autosave (design brief §9) is a pure client convenience via
// order-draft-storage.ts: customer-scoped localStorage, no DB writes, no
// credentials, cleared the moment the form is actually submitted.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DesignOption, SuitType, CollarType, BainType, CuffType, GheraType } from "@prisma/client";
import { createCustomerAndOrder } from "@/lib/customer-order-actions";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { enqueueCreateOrder, processSyncQueue } from "@/lib/offline/sync-engine";
import { navigateAfterLocalSave } from "@/lib/offline/navigate";
import { printPreviewUrl } from "@/lib/order-navigation";
// Step 28: broadened from Prisma's Measurement type to this shared shape —
// the resolved prefill value may now be either a Measurement row or a
// MeasurementSnapshot row (see measurement-prefill.ts). Only the fields
// both models share identically are used anywhere below, so this is a
// pure type widening, not a behaviour change.
import type { PrefillMeasurement } from "@/lib/measurement-prefill";
import {
  SUIT_TYPE_OPTIONS,
  COLLAR_TYPE_OPTIONS,
  BAIN_TYPE_OPTIONS,
  CUFF_TYPE_OPTIONS,
  GHERA_TYPE_OPTIONS,
} from "@/lib/order-options";
import { StyleTile } from "./style-tile";
import {
  OrderMeasurementBlock,
  emptyMeasurementBlockValues,
  measurementBlockValuesFrom,
  type MeasurementBlockValues,
} from "./order-measurement-block";
import { loadOrderDraft, saveOrderDraft, clearOrderDraft } from "@/lib/order-draft-storage";
import { MONEY_REGEX, isAdvanceWithinTotal, calculateBalance } from "@/lib/money";
import type { DefaultPricesMap } from "@/lib/shop-settings";
import { SectionCard } from "@/components/ui/section-card";
import { en } from "@/lib/locale";

// Step 49 — section ids for the sticky section nav below. Purely a
// presentational addition: plain <a href="#id"> anchors (native browser
// scroll, no router involved) plus an IntersectionObserver that only
// ever reads which section is currently on screen to highlight the
// matching nav pill. Nothing here touches form state, submission,
// autosave, or the measurement block's own Enter/Tab sequence — none of
// which share any keys with this feature.
const SECTION_LABELS: Record<string, string> = {
  customer: en.orderForm.customerInfo,
  measurements: en.orderForm.defaultMeasurements,
  styles: en.orderForm.suitsAndStyles,
  payment: en.orderForm.payment,
};

interface SuitState {
  override: boolean;
  values: MeasurementBlockValues;
}

/**
 * Rough (not cent-exact) suggestion only — total * percent / 100, shown
 * as a starting point the owner can freely edit before submit. The
 * authoritative balance is still always calculateBalance() server-side
 * (money.ts), never this.
 */
function computeAdvanceSuggestion(totalAmount: string, percent: string): string {
  const total = Number(totalAmount);
  const pct = Number(percent);
  if (!Number.isFinite(total) || !Number.isFinite(pct)) return "";
  return ((total * pct) / 100).toFixed(2);
}

interface DraftShape {
  // Step 25 — only ever read/written in mode="new"; simply carried along
  // (always empty) for an existing customer, same as any other field
  // that particular mode doesn't use.
  customerName: string;
  customerPhonePrimary: string;
  customerPhoneSecondary: string;
  customerAddress: string;
  orderDate: string;
  deliveryDate: string;
  deliveryTouched: boolean;
  suitType: SuitType;
  collarType: CollarType;
  bainType: BainType;
  cuffType: CuffType;
  gheraType: GheraType;
  pocketOptionId: string;
  quantity: number;
  totalAmount: string;
  totalTouched: boolean;
  advanceAmount: string;
  advanceTouched: boolean;
  note: string;
  // Step 24: pure post-save navigation choice — never written to the
  // Order row, so it round-trips through the same draft object as
  // everything else here without any special-case persistence logic.
  sendOnWhatsApp: boolean;
  defaultValues: MeasurementBlockValues;
  defaultNote: string;
  items: SuitState[];
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function makeInitialState(measurement: PrefillMeasurement | null, defaultPrices: DefaultPricesMap): DraftShape {
  // Deliberately not date-derived: this is a client component, so its
  // first render also happens once on the server for the initial HTML.
  // Seeding orderDate from `new Date()` here could disagree with the
  // browser's own clock/timezone and produce a hydration mismatch. The
  // real "today" default is filled in by the mount effect below instead,
  // which only ever runs in the browser.
  const initialSuitType = SUIT_TYPE_OPTIONS[0].value;
  return {
    customerName: "",
    customerPhonePrimary: "",
    customerPhoneSecondary: "",
    customerAddress: "",
    orderDate: "",
    deliveryDate: "",
    deliveryTouched: false,
    suitType: initialSuitType,
    collarType: COLLAR_TYPE_OPTIONS[0].value,
    bainType: BAIN_TYPE_OPTIONS[0].value,
    cuffType: CUFF_TYPE_OPTIONS[0].value,
    gheraType: GHERA_TYPE_OPTIONS[0].value,
    pocketOptionId: "",
    quantity: 1,
    // Step 18: a configured Settings default price for the initially-
    // selected suit type pre-fills Total — same as if the owner had just
    // clicked that tile. Still just a starting point: typing in the
    // field (totalTouched) stops any further auto-fill immediately.
    totalAmount: defaultPrices[initialSuitType] ?? "",
    totalTouched: false,
    advanceAmount: "",
    advanceTouched: false,
    note: "",
    // Checked by default for a new order (design brief §9): "There is
    // also a Send on WhatsApp checkbox on the order form, checked by
    // default, because some customers give a neighbour's number."
    sendOnWhatsApp: true,
    defaultValues: measurementBlockValuesFrom(measurement),
    defaultNote: measurement?.note ?? "",
    items: [{ override: false, values: emptyMeasurementBlockValues() }],
  };
}

export function OrderForm({
  mode = "existing",
  customerId,
  customerExists = false,
  measurement,
  pocketOptions,
  error,
  defaultAdvancePercent = null,
  defaultPrices = {},
}: {
  /** Step 25 — "new" renders the editable customer-info block and submits through createCustomerAndOrder. Defaults to the original "existing" behaviour, unchanged. Phase 6 made "existing" local-first (see handleSubmit below) — "new" is unchanged, still Server-Action-submitted. */
  mode?: "existing" | "new";
  /** Required when mode="existing" (an existing customer's id); ignored in mode="new", where no customer exists yet. */
  customerId?: string;
  /** Phase 6 — mode="existing" only: from the server-rendered page's own Prisma read, whether Postgres has a (non-deleted) customer row for this id yet. A customer created offline and not yet synced has none, but may still exist locally (see the mount effect below). Ignored in mode="new". */
  customerExists?: boolean;
  measurement: PrefillMeasurement | null;
  pocketOptions: DesignOption[];
  error?: string;
  /** Settings (Step 18) — a configured default advance %, or null if none is set. Only ever suggests a starting value; never forces one. */
  defaultAdvancePercent?: string | null;
  /** Settings (Step 18) — configured default total per suit type, where set. */
  defaultPrices?: DefaultPricesMap;
}) {
  const isNewCustomer = mode === "new";
  const router = useRouter();
  // Step 25: the localStorage draft key for mode="new" is the fixed
  // string "new" — real customer ids are always cuids (e.g.
  // "cmt...") and can never collide with that literal, so a brand-new-
  // customer draft can never overwrite or be confused with any existing
  // customer's draft, and vice versa. order-draft-storage.ts itself is
  // untouched — it already takes an opaque string key.
  const draftKey = isNewCustomer ? "new" : customerId!;
  // Phase 6 — mode="new" still submits natively through the existing
  // createCustomerAndOrder Server Action (out of this phase's scope,
  // same scoping decision Phase 5 made for customer creation). This
  // form prop is only ever actually used by the browser for that mode —
  // handleSubmit below intercepts and preventDefault()s everything else.
  const action = isNewCustomer ? createCustomerAndOrder : undefined;
  const formRef = useRef<HTMLFormElement>(null);

  const [state, setState] = useState<DraftShape>(() => makeInitialState(measurement, defaultPrices));
  const [defaultActiveField, setDefaultActiveField] = useState("length");
  const [itemActiveFields, setItemActiveFields] = useState<string[]>(["length"]);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftLoadedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notFoundEverywhere, setNotFoundEverywhere] = useState(false);

  // Phase 6 — confirms the customer exists SOMEWHERE (server or local)
  // before letting an existing-customer order be created; a customer
  // created offline and not yet synced has no Postgres row yet, but
  // does have a local one. Same pattern as MeasurementForm's own mount
  // effect (measurement-form.tsx).
  useEffect(() => {
    if (isNewCustomer) return;
    let cancelled = false;
    async function checkCustomer() {
      if (!isOfflineDbAvailable()) return;
      try {
        const db = getOfflineDb();
        await db.open();
        const local = await db.customers.get(customerId!);
        if (cancelled) return;
        const existsLocally = !!(local && !local.deletedAt);
        if (!customerExists && !existsLocally) {
          setNotFoundEverywhere(true);
        }
      } catch {
        // Best-effort only — if Dexie can't be read, fall back to
        // whatever the server-rendered page already determined.
      }
    }
    checkCustomer();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // Step 49 — sticky section nav (visual-only "where am I" indicator,
  // not a wizard: every section still renders inline, nothing gates
  // scrolling or submitting past another).
  const sectionIds = isNewCustomer ? ["customer", "measurements", "styles", "payment"] : ["measurements", "styles", "payment"];
  const [activeSection, setActiveSection] = useState<string>(sectionIds[0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // sectionIds is derived from `mode`, which never changes after mount
    // (same "stable across the component's lifetime" rationale the draft-
    // load effect below already relies on for `draftKey`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load any saved draft once, after mount (client-only — see
  // order-draft-storage.ts). Runs after the fresh-default render so
  // server/client hydration always match on first paint.
  useEffect(() => {
    const draft = loadOrderDraft<DraftShape>(draftKey);
    if (draft) {
      // A draft saved before Step 24 has no sendOnWhatsApp key at all —
      // `undefined` would silently read as unchecked. Defaulting a
      // genuinely-missing key to true (not overriding an explicit false
      // from a newer draft) keeps the "checked by default" rule honest
      // for that one narrow case without touching how every other field
      // already round-trips through this same object.
      setState(draft.sendOnWhatsApp === undefined ? { ...draft, sendOnWhatsApp: true } : draft);
      setItemActiveFields(draft.items.map(() => "length"));
      setDraftRestored(true);
    } else {
      const today = toISODate(new Date());
      setState((prev) => ({ ...prev, orderDate: today, deliveryDate: addDays(today, 7) }));
    }
    draftLoadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Debounced autosave — a few seconds after the last change, matching the
  // design brief's "autosave every few seconds", not on every keystroke.
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const timer = setTimeout(() => saveOrderDraft(draftKey, state), 1500);
    return () => clearTimeout(timer);
  }, [draftKey, state]);

  function update<K extends keyof DraftShape>(key: K, value: DraftShape[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function handleOrderDateChange(value: string) {
    setState((prev) => ({
      ...prev,
      orderDate: value,
      deliveryDate: prev.deliveryTouched ? prev.deliveryDate : addDays(value || toISODate(new Date()), 7),
    }));
  }

  function handleDeliveryDateChange(value: string) {
    setState((prev) => ({ ...prev, deliveryDate: value, deliveryTouched: true }));
  }

  function handleQuantityChange(raw: string) {
    const n = Math.max(1, Math.min(20, parseInt(raw, 10) || 1));
    setState((prev) => {
      const items = prev.items.slice(0, n);
      while (items.length < n) items.push({ override: false, values: emptyMeasurementBlockValues() });
      return { ...prev, quantity: n, items };
    });
    setItemActiveFields((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("length");
      return next;
    });
  }

  function toggleOverride(position: number, on: boolean) {
    setState((prev) => {
      const items = [...prev.items];
      items[position - 1] = { ...items[position - 1], override: on };
      return { ...prev, items };
    });
  }

  function setItemFieldValue(position: number, key: string, value: string) {
    setState((prev) => {
      const items = [...prev.items];
      items[position - 1] = { ...items[position - 1], values: { ...items[position - 1].values, [key]: value } };
      return { ...prev, items };
    });
  }

  function discardDraft() {
    clearOrderDraft(draftKey);
    setState(makeInitialState(measurement, defaultPrices));
    setItemActiveFields(["length"]);
    setDraftRestored(false);
  }

  function handleSuitTypeChange(value: SuitType) {
    setState((prev) => ({
      ...prev,
      suitType: value,
      // Only ever fills a blank/not-yet-touched Total — never overwrites
      // something the owner already typed, and never clears a value down
      // to blank just because the newly-selected type has no configured
      // default price.
      totalAmount: !prev.totalTouched && defaultPrices[value] ? defaultPrices[value]! : prev.totalAmount,
    }));
  }

  function handleTotalAmountChange(value: string) {
    setState((prev) => ({ ...prev, totalAmount: value, totalTouched: true }));
  }

  function handleAdvanceAmountChange(value: string) {
    setState((prev) => ({ ...prev, advanceAmount: value, advanceTouched: true }));
  }

  // Phase 6 (offline-first) — mode="existing" only: local-first order
  // creation. `formData` is exactly what createOrder's Server Action
  // has always received (same field names — orderDate, suitType,
  // "default.*", "item.N.*", etc.), read here via the browser's own
  // FormData(formElement) rather than duplicated field-by-field, so
  // enqueueCreateOrder can pass it straight through to
  // validateOrderInput() server-side unchanged.
  //
  // mode="new" is unchanged: this handler returns before doing anything
  // else, and the form's native action={createCustomerAndOrder}
  // submission proceeds exactly as it always has (see the `action`
  // definition above) — out of Phase 6's scope, same as Phase 5's
  // customer-creation work.
  //
  // This is the one local-first form in the app that awaits the
  // immediate sync attempt before navigating, rather than firing it and
  // moving on immediately (contrast with new-customer-form.tsx,
  // measurement-form.tsx, order-status-form.tsx): a successful order
  // save has always landed on S5 Print Preview (printPreviewUrl), which
  // reads the order live from Postgres and would 404 for one that
  // hasn't synced yet. Awaiting keeps that exact destination for the
  // normal (online) case — typically a sub-second wait — while an
  // offline or failed-to-sync save instead lands on the customer's
  // profile, where the new PendingOrdersNotice shows it as pending
  // (customer-identity-card.tsx's sibling for orders). The order itself
  // is durably saved locally the instant enqueueCreateOrder resolves,
  // regardless of which destination is chosen next.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Cleared the instant the order is actually submitted — a stale draft
    // must never resurface for an order that now exists. Unchanged for
    // both modes.
    clearOrderDraft(draftKey);

    if (isNewCustomer) {
      return;
    }

    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const result = await enqueueCreateOrder(customerId!, formData);
    if (!result.queued || !result.id) {
      setLocalError(result.message ?? "Could not save order.");
      setSubmitting(false);
      return;
    }
    const orderId = result.id;

    await processSyncQueue().catch(() => {});

    // Re-reads the order's OWN local row rather than trusting
    // processSyncQueue()'s aggregate syncedCount — the queue is FIFO
    // and may have synced other, older pending items first without
    // reaching this one yet (e.g. a still-pending measurement edit from
    // earlier in the session).
    let synced = false;
    if (isOfflineDbAvailable()) {
      try {
        const db = getOfflineDb();
        const localOrder = await db.orders.get(orderId);
        synced = localOrder?.syncStatus === "synced";
      } catch {
        synced = false;
      }
    }

    // Phase 11 (§10) — see navigate.ts's own comment. `synced` already
    // implies we were online moments ago, so this is a no-op change for
    // that branch (still router.push); the real target is the `else`
    // branch, reached whenever offline.
    if (synced) {
      navigateAfterLocalSave(router, printPreviewUrl(customerId!, orderId, state.sendOnWhatsApp));
    } else {
      navigateAfterLocalSave(router, `/customers/${customerId}`);
    }
  }

  // Step 18: while the owner hasn't typed into Advance themselves, its
  // displayed (and submitted — this IS the controlled input's value)
  // amount is a live-computed suggestion from Settings' default advance
  // percentage. Purely a starting point: the moment they type anything,
  // advanceTouched takes over and this suggestion stops applying.
  const advanceValue =
    !state.advanceTouched && defaultAdvancePercent && MONEY_REGEX.test(state.totalAmount)
      ? computeAdvanceSuggestion(state.totalAmount, defaultAdvancePercent)
      : state.advanceAmount;

  const balance = MONEY_REGEX.test(state.totalAmount) && MONEY_REGEX.test(advanceValue)
    ? calculateBalance(state.totalAmount, advanceValue)
    : null;
  const advanceExceedsTotal =
    MONEY_REGEX.test(state.totalAmount) && MONEY_REGEX.test(advanceValue)
      ? !isAdvanceWithinTotal(state.totalAmount, advanceValue)
      : false;

  if (notFoundEverywhere) {
    return (
      <p className="mt-6 rounded-sm border border-dashed border-rule bg-card p-4 text-sm text-graphite/60">
        This customer could not be found, locally or on the server.
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={handleSubmit}
      // Step 38 — lets GlobalShortcuts find and requestSubmit() this
      // exact form for Ctrl+P "save and print" (design brief §9), the
      // same data-attribute pattern S1's search input already uses. Pure
      // hook for an external trigger — changes nothing about how this
      // form itself validates, submits, or redirects.
      data-shortcut-target="order-form"
      className="mt-6 space-y-8 pb-16"
    >
      {/* Step 49 — lightweight section awareness, not a wizard: plain
          same-page anchors (no client-side navigation, no gating), with
          the current section's pill highlighted via the IntersectionObserver
          above. Every section below still renders continuously regardless
          of scroll position or which pill is active. */}
      <nav aria-label="Order form sections" className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-sm border border-rule bg-card p-1.5 shadow-sm">
        {sectionIds.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            className={`whitespace-nowrap rounded-sm px-3.5 py-1.5 text-sm font-medium transition ${
              activeSection === id ? "bg-indigo text-white" : "text-graphite/70 hover:bg-paper hover:text-ink"
            }`}
          >
            {SECTION_LABELS[id]}
          </a>
        ))}
      </nav>

      {draftRestored && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber bg-amber/10 px-4 py-2 text-sm text-graphite">
          <span>{en.orderForm.draftRestored}</span>
          <button type="button" onClick={discardDraft} className="text-indigo hover:underline">
            {en.orderForm.discardDraft}
          </button>
        </div>
      )}

      {/* Step 25 — new-customer mode only. Reuses the exact same field
          labels/optional-suffix strings the plain /customers/new form
          uses (en.customerForm.*), and the exact same field `name`
          attributes parseCustomerInput() already expects — no second,
          incompatible customer-validation vocabulary. */}
      {isNewCustomer && (
        <SectionCard id="customer" title={en.orderForm.customerInfo}>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-graphite">
                {en.customerForm.name}
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                autoFocus
                value={state.customerName}
                onChange={(event) => update("customerName", event.target.value)}
                className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="phonePrimary" className="block text-sm font-medium text-graphite">
                  {en.customerForm.phonePrimary}
                </label>
                <input
                  id="phonePrimary"
                  name="phonePrimary"
                  type="tel"
                  required
                  value={state.customerPhonePrimary}
                  onChange={(event) => update("customerPhonePrimary", event.target.value)}
                  className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
                />
              </div>
              <div>
                <label htmlFor="phoneSecondary" className="block text-sm font-medium text-graphite">
                  {en.customerForm.phoneSecondary}{" "}
                  <span className="font-normal text-graphite/50">({en.customerForm.optional})</span>
                </label>
                <input
                  id="phoneSecondary"
                  name="phoneSecondary"
                  type="tel"
                  value={state.customerPhoneSecondary}
                  onChange={(event) => update("customerPhoneSecondary", event.target.value)}
                  className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
                />
              </div>
            </div>
            <div>
              <label htmlFor="address" className="block text-sm font-medium text-graphite">
                {en.customerForm.address} <span className="font-normal text-graphite/50">({en.customerForm.optional})</span>
              </label>
              <textarea
                id="address"
                name="address"
                rows={2}
                value={state.customerAddress}
                onChange={(event) => update("customerAddress", event.target.value)}
                className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
              />
            </div>
          </div>
        </SectionCard>
      )}

      {/* Default measurements */}
      <SectionCard id="measurements" title={en.orderForm.defaultMeasurements}>
        <p className="-mt-1 mb-3 text-xs text-graphite/50">{en.orderForm.defaultMeasurementsHint}</p>
        <div>
          <OrderMeasurementBlock
            blockId="default"
            namePrefix="default"
            values={state.defaultValues}
            onChange={(key, value) => setState((prev) => ({ ...prev, defaultValues: { ...prev.defaultValues, [key]: value } }))}
            originalValues={measurementBlockValuesFrom(measurement)}
            activeField={defaultActiveField}
            onActiveFieldChange={setDefaultActiveField}
            showDiagram
            noteValue={state.defaultNote}
            onNoteChange={(v) => update("defaultNote", v)}
          />
        </div>
      </SectionCard>

      {/* Styles */}
      <SectionCard id="styles" title={en.orderForm.suitsAndStyles}>
        <div>
          <label htmlFor="quantity" className="block text-sm font-medium text-graphite">
            {en.orderForm.quantity}
          </label>
          <input
            id="quantity"
            type="text"
            inputMode="numeric"
            value={state.quantity}
            onChange={(event) => handleQuantityChange(event.target.value)}
            className="mt-1 w-20 rounded-sm border border-rule bg-paper px-3 py-1.5 text-center text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
          />
          <input type="hidden" name="quantity" value={state.quantity} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <TileGroup
            legend={en.orderForm.suitType}
            name="suitType"
            options={SUIT_TYPE_OPTIONS}
            value={state.suitType}
            onChange={(v) => handleSuitTypeChange(v as SuitType)}
          />
          <TileGroup
            legend={en.orderForm.collar}
            name="collarType"
            options={COLLAR_TYPE_OPTIONS}
            value={state.collarType}
            onChange={(v) => update("collarType", v as CollarType)}
          />
          <TileGroup
            legend={en.orderForm.bain}
            name="bainType"
            options={BAIN_TYPE_OPTIONS}
            value={state.bainType}
            onChange={(v) => update("bainType", v as BainType)}
          />
          <TileGroup
            legend={en.orderForm.cuff}
            name="cuffType"
            options={CUFF_TYPE_OPTIONS}
            value={state.cuffType}
            onChange={(v) => update("cuffType", v as CuffType)}
          />
          <TileGroup
            legend={en.orderForm.pocket}
            name="pocketOptionId"
            options={pocketOptions.map((o) => ({ value: o.id, label: o.label }))}
            value={state.pocketOptionId}
            onChange={(v) => update("pocketOptionId", v)}
            allowEmpty
          />
          <TileGroup
            legend={en.orderForm.ghera}
            name="gheraType"
            options={GHERA_TYPE_OPTIONS}
            value={state.gheraType}
            onChange={(v) => update("gheraType", v as GheraType)}
          />
        </div>

        {/* Per-suit overrides */}
        <div className="mt-6 space-y-3 border-t border-rule pt-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink">{en.orderForm.perSuitOverridesHeading}</p>
          {state.items.map((item, index) => {
            const position = index + 1;
            return (
              <div key={position} className="rounded-sm border border-rule/70 bg-paper p-3">
                <label className="flex items-center gap-2.5 text-sm font-medium text-graphite">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo/10 text-xs font-semibold tabular-nums text-indigo">
                    {position}
                  </span>
                  <input
                    type="checkbox"
                    checked={item.override}
                    onChange={(event) => toggleOverride(position, event.target.checked)}
                    className="h-4 w-4 rounded-sm border-rule text-indigo focus:ring-indigo"
                  />
                  {en.orderForm.suitLabelTemplate.replace("{n}", String(position))} —{" "}
                  {en.orderForm.overrideToggle}
                </label>
                {item.override && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-graphite/50">{en.orderForm.overrideHint}</p>
                    <OrderMeasurementBlock
                      blockId={`item-${position}`}
                      namePrefix={`item.${position}`}
                      values={item.values}
                      onChange={(key, value) => setItemFieldValue(position, key, value)}
                      activeField={itemActiveFields[index] ?? "length"}
                      onActiveFieldChange={(key) =>
                        setItemActiveFields((prev) => {
                          const next = [...prev];
                          next[index] = key;
                          return next;
                        })
                      }
                    />
                  </div>
                )}
                {/* The toggle itself is client-only state — the server infers
                    override from whether measurement values were actually
                    entered, but sending it explicitly lets an all-empty,
                    deliberately-blanked override be told apart from "off"
                    if that distinction is ever needed later. */}
                <input type="hidden" name={`item.${position}.override`} value={item.override ? "on" : "off"} />
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Payment — Step 49: Total/Advance/Delivery Date given the
          strongest visual weight in the form (larger value type, each in
          its own labeled block), and Balance is now a dedicated callout
          whose tone honestly reflects the live-computed amount: amber
          while something is still owed (the app's existing "attention"
          meaning), success/green the moment it's fully paid (advance ==
          total) — never a new/confusing color meaning, and never shown
          before both Total and Advance are valid numbers (still `— `via
          the same `balance` value computed below, unchanged). Order Date
          keeps its existing, smaller/secondary treatment — it defaults
          itself and is rarely the field an owner needs to double-check. */}
      <SectionCard id="payment" title={en.orderForm.payment}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="deliveryDate" className="block text-sm font-medium text-graphite">
              {en.orderForm.deliveryDate}
            </label>
            <input
              id="deliveryDate"
              name="deliveryDate"
              type="date"
              value={state.deliveryDate}
              onChange={(event) => handleDeliveryDateChange(event.target.value)}
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2.5 text-base font-medium text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
            <p className="mt-0.5 text-xs text-graphite/50">{en.orderForm.deliveryDateHint}</p>
          </div>
          <div>
            <label htmlFor="orderDate" className="block text-sm font-medium text-graphite">
              {en.orderForm.orderDate}
            </label>
            <input
              id="orderDate"
              name="orderDate"
              type="date"
              required
              value={state.orderDate}
              onChange={(event) => handleOrderDateChange(event.target.value)}
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="totalAmount" className="block text-sm font-medium text-graphite">
              {en.orderForm.total}
            </label>
            <input
              id="totalAmount"
              name="totalAmount"
              type="text"
              inputMode="decimal"
              required
              value={state.totalAmount}
              onChange={(event) => handleTotalAmountChange(event.target.value)}
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2.5 text-right text-lg font-semibold tabular-nums text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
            {!state.totalTouched && defaultPrices[state.suitType] === state.totalAmount && state.totalAmount && (
              <p className="mt-0.5 text-xs text-graphite/50">{en.orderForm.totalSuggested}</p>
            )}
          </div>
          <div>
            <label htmlFor="advanceAmount" className="block text-sm font-medium text-graphite">
              {en.orderForm.advance}
            </label>
            <input
              id="advanceAmount"
              name="advanceAmount"
              type="text"
              inputMode="decimal"
              required
              value={advanceValue}
              onChange={(event) => handleAdvanceAmountChange(event.target.value)}
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2.5 text-right text-lg font-semibold tabular-nums text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
            {!state.advanceTouched && advanceValue && advanceValue !== state.advanceAmount && (
              <p className="mt-0.5 text-xs text-graphite/50">{en.orderForm.advanceSuggested}</p>
            )}
          </div>
        </div>

        <div
          className={`mt-4 flex items-center justify-between rounded-sm border px-4 py-3 ${
            balance === null
              ? "border-rule bg-paper"
              : Number(balance) > 0
                ? "border-amber bg-amber/10"
                : "border-success bg-success/10"
          }`}
        >
          <span className="text-sm font-medium text-graphite">{en.orderForm.balance}</span>
          <span
            className={`text-xl font-semibold tabular-nums ${
              balance === null ? "text-graphite" : Number(balance) > 0 ? "text-amber" : "text-success"
            }`}
          >
            {balance ?? "—"}
          </span>
        </div>
        {advanceExceedsTotal && <p className="mt-2 text-sm text-amber">{en.orderForm.advanceExceedsTotal}</p>}

        <div className="mt-4">
          <label htmlFor="note" className="block text-sm font-medium text-graphite">
            {en.orderForm.note} <span className="font-normal text-graphite/50">({en.orderForm.notePlaceholder})</span>
          </label>
          <textarea
            id="note"
            name="note"
            rows={2}
            value={state.note}
            onChange={(event) => update("note", event.target.value)}
            className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
          />
        </div>
      </SectionCard>

      {(localError ?? error) && (
        <p role="alert" className="rounded-sm border border-amber bg-amber/10 px-4 py-2 text-sm text-graphite">
          {localError ?? error}
        </p>
      )}

      {/* Step 24 — checked by default (design brief §9). Purely a
          post-save navigation choice — nothing here is persisted. For
          mode="new" createCustomerAndOrder still decides the redirect
          from its own submitted form field; for mode="existing" (Phase
          6) handleSubmit above reads it from `state.sendOnWhatsApp`
          directly, since that path no longer round-trips through a
          Server Action's own formData.get() call. */}
      <label className="flex items-center gap-2 rounded-sm border border-rule bg-card px-4 py-3 text-sm text-graphite shadow-sm">
        <input
          type="checkbox"
          checked={state.sendOnWhatsApp}
          onChange={(event) => update("sendOnWhatsApp", event.target.checked)}
          className="h-4 w-4 rounded-sm border-rule text-indigo focus:ring-indigo"
        />
        {en.orderForm.sendOnWhatsApp}
      </label>
      <input type="hidden" name="sendOnWhatsApp" value={state.sendOnWhatsApp ? "on" : "off"} />

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-sm bg-indigo px-4 py-3.5 text-base font-medium text-white shadow-sm transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2 disabled:opacity-60"
      >
        {submitting ? en.orderForm.saving : en.orderForm.save}
      </button>
    </form>
  );
}

function TileGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  allowEmpty = false,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T | string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  // Step 50 — legend now matches the same small-caps section-label
  // treatment used everywhere else in the redesigned form (SectionCard's
  // own <h2>, the measurement block's FieldGroup legend): uppercase,
  // tracking-widest, ink-colored, with the same thin bottom rule. Purely
  // typographic — the fieldset/legend semantics, the tile options, and
  // `onChange`/`value` wiring below are unchanged.
  return (
    <fieldset>
      <legend className="mb-2 w-full border-b border-rule pb-1.5 text-xs font-semibold uppercase tracking-widest text-ink">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {allowEmpty && (
          <StyleTile label={en.orderForm.notSpecified} selected={value === ""} onSelect={() => onChange("")} />
        )}
        {options.map((option) => (
          <StyleTile key={option.value} label={option.label} selected={value === option.value} onSelect={() => onChange(option.value)} />
        ))}
      </div>
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}
