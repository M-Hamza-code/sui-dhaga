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
// order, matching the design brief's style-block table. Patti Style
// (Step 57) is also collected, order-level only like the rest of this
// paragraph — there is no per-suit Patti override (OrderItem has no
// pattiOptionId column; see DraftShape's own comment).
//
// Autosave (design brief §9) is a pure client convenience via
// order-draft-storage.ts: customer-scoped localStorage, no DB writes, no
// credentials, cleared the moment the form is actually submitted.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DesignOption, SuitType, CollarType, BainType, CuffType, GheraType, MeasurementMode, CoatGarmentSelection, OrderStatus } from "@prisma/client";
import { createCustomerAndOrder } from "@/lib/customer-order-actions";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { enqueueCreateOrder, enqueueUpdateOrder, processSyncQueue } from "@/lib/offline/sync-engine";
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
  DESIGN_OPTION_IMAGES,
} from "@/lib/order-options";
import { StyleTile } from "./style-tile";
import { DuplicatePhoneNotice } from "@/components/customers/duplicate-phone-notice";
import {
  OrderMeasurementBlock,
  emptyMeasurementBlockValues,
  measurementBlockValuesFrom,
  type MeasurementBlockValues,
} from "./order-measurement-block";
import {
  CoatMeasurementBlock,
  emptyCoatMeasurementBlockValues,
  coatMeasurementBlockValuesFrom,
  type CoatMeasurementBlockValues,
} from "./coat-measurement-block";
import type { PrefillCoatMeasurement } from "@/lib/coat-measurement-prefill";
import { includesPrinceCoat, includesWaistcoat } from "@/lib/coat-garment-selection";
import {
  hasKameezMeasurementDataClient,
  hasPrinceCoatMeasurementDataClient,
  hasWaistcoatMeasurementDataClient,
} from "@/lib/garment-ordered";
import { loadOrderDraft, saveOrderDraft, clearOrderDraft } from "@/lib/order-draft-storage";
import { MONEY_REGEX, isAdvanceWithinTotal, calculateBalance } from "@/lib/money";
import type { DefaultPricesMap, DefaultGarmentPricesMap } from "@/lib/shop-settings";
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
  orderType: en.orderForm.orderTypeHeading,
  kameez: en.orderForm.kameezShalwarOrder,
  princeCoat: en.orderForm.princeCoatOrderSection,
  waistcoat: en.orderForm.waistcoatOrderSection,
  payment: en.orderForm.payment,
};

/**
 * Nav-link visibility fix — the three garment section ids each only get
 * a nav pill while they're the CURRENTLY ACTIVE tab (the sections
 * themselves are unaffected by this — still all three CSS-hidden/shown
 * exactly as before; this only changes which pills the sticky nav
 * itself renders). customer/orderType/payment aren't in this map, so
 * they're always shown — see the sectionIds.filter() call site.
 */
const GARMENT_SECTION_TAB: Partial<Record<string, "KAMEEZ" | "PRINCE_COAT" | "WAISTCOAT">> = {
  kameez: "KAMEEZ",
  princeCoat: "PRINCE_COAT",
  waistcoat: "WAISTCOAT",
};

// Step 50 — one suit's (position 2+) own style. Position 1 has no entry
// of its own — the top-level suitType/collarType/... state IS suit 1's
// style, exactly as it always was; this shape only exists so suit 2 and
// beyond can each hold an independent choice for the same six fields.
interface SuitStyleState {
  // Upgrade — Suit Type, like Cuff/Ghera below, can now be deliberately
  // "Not Specified" ("") — same empty-string-sentinel convention
  // Collar/Bain/pocketOptionId/pattiOptionId already use.
  suitType: SuitType | "";
  // Step 63 — combined single choice: exactly one of these two is ever
  // non-empty, never both, never neither. "" means "not selected", the
  // same empty-string-sentinel convention pocketOptionId/pattiOptionId
  // already use for their own optional-selection fields.
  collarType: CollarType | "";
  bainType: BainType | "";
  cuffType: CuffType | "";
  gheraType: GheraType | "";
  pocketOptionId: string;
}

interface SuitState {
  override: boolean;
  values: MeasurementBlockValues;
  // Present on every entry (including position 1, for a uniform shape)
  // but only ever read/submitted for position 2 and beyond — see
  // setItemStyleField and the per-suit style blocks below.
  style: SuitStyleState;
}

// Three-tab Order Type redesign — one Prince Coat OR Waistcoat entry's
// own state. No `garmentSelection` field any more: which garment an entry
// is for is now implied entirely by which array it lives in
// (state.princeCoatItems vs state.waistcoatItems), not an admin-facing
// per-entry dropdown — the tab the admin is on already says which
// garment they're adding. Deliberately has no `style` field either (Coat
// entries never had Suit & Styles tiles).
interface CoatSuitState {
  override: boolean;
  values: CoatMeasurementBlockValues;
}

// Step 53 — Edit Order. The exact shape an existing order's current state
// needs to be in for makeInitialStateFromOrder (below) to seed the form —
// deliberately NOT the raw Prisma Order/OrderItem/MeasurementSnapshot
// shape (those carry Decimal/Date objects and relation objects this
// client component should never receive directly); the edit page builds
// this from getOrderPrintData()'s already-resolved per-suit style +
// measurement data, the exact same resolution order detail/print/work
// order already use, so the edit form opens with the same values those
// pages already show.
export interface OrderEditData {
  orderId: string;
  /** yyyy-mm-dd — Order Date is read-only in edit mode (see the form's own comment on why); this is only ever redisplayed, never recomputed. */
  orderDateDisplay: string;
  deliveryDate: string; // yyyy-mm-dd, or ""
  /** The order's own top-level measurementMode column — only used (by makeInitialStateFromOrder) as the fallback for an item whose own measurementMode is null, so a pre-redesign single-mode order's items still resolve to the right bucket. Never itself an admin-facing choice any more. */
  measurementMode: MeasurementMode;
  // Upgrade — all three may legitimately be "" (Not Specified), same as
  // collarType/bainType below always could be.
  suitType: SuitType | "";
  // Step 63 — see SuitStyleState's own comment: exactly one of these two
  // is set on the server, and this may legitimately be "" for whichever
  // one isn't.
  collarType: CollarType | "";
  bainType: BainType | "";
  cuffType: CuffType | "";
  gheraType: GheraType | "";
  pocketOptionId: string;
  pattiOptionId: string;
  panchaOptionId: string;
  totalAmount: string;
  advanceAmount: string;
  /** The actual Coat/Waistcoat per-unit price frozen on this order — see Order.princeCoatUnitPrice's own schema.prisma comment. "" when this order has no Coat/Waistcoat entries. */
  princeCoatUnitPrice: string;
  waistcoatUnitPrice: string;
  note: string;
  /** The order's current server `updatedAt` (ISO) — becomes the edit's conflict-guard baseline (order-update.ts), same role UpdateCustomerPayload's baseUpdatedAt already plays. */
  baseUpdatedAt: string;
  defaultMeasurement: PrefillMeasurement | null;
  defaultCoatMeasurement: PrefillCoatMeasurement | null;
  defaultNote: string;
  items: {
    position: number;
    override: boolean;
    measurement: PrefillMeasurement | null;
    coatMeasurement: PrefillCoatMeasurement | null;
    /** null = this suit currently inherits the order's own style (always true for position 1). */
    style: SuitStyleState | null;
    /** null = this suit currently inherits the order's own measurementMode (always true for position 1). */
    measurementMode: MeasurementMode | null;
    /** Explicit garment selection upgrade — getOrderPrintData() already resolves NULL (pre-upgrade Coat items) to "BOTH"; only meaningful when this item's effective measurementMode is COAT. */
    coatGarmentSelection: CoatGarmentSelection;
  }[];
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
  // Upgrade — "Not Specified" is now a real choice for all three, same as
  // collarType/bainType already were. These, and everything else in this
  // group, are the Kameez/Shalwar Order section's own order-level
  // ("suit 1's") style — meaningless/unsubmitted when kameezQuantity is 0.
  suitType: SuitType | "";
  // Step 63 — see SuitStyleState's own comment.
  collarType: CollarType | "";
  bainType: BainType | "";
  cuffType: CuffType | "";
  gheraType: GheraType | "";
  pocketOptionId: string;
  // Step 57 — order-level only, no per-suit entry (unlike the six fields
  // above, which each also live in SuitStyleState) — OrderItem has no
  // pattiOptionId column, matching the schema exactly, no migration.
  pattiOptionId: string;
  // Pancha Style — same order-level-only shape as pattiOptionId above.
  panchaOptionId: string;
  // Three-tab Order Type redesign — three fully independent counts/item
  // lists (Kameez/Shalwar, Prince Coat, Waistcoat), each can be 0 or more
  // with no "not simultaneously" restriction among them (any combination,
  // including all three at once, is valid — see validateOrderInput's own
  // check). `activeOrderTab` is PURELY a navigation concern — which one
  // section is currently visible — completely independent of which
  // types actually have entries: switching tabs never changes any of the
  // three quantities/item lists below, so navigating away from a tab and
  // back always shows exactly what was there before.
  activeOrderTab: "KAMEEZ" | "PRINCE_COAT" | "WAISTCOAT";
  kameezQuantity: number;
  kameezItems: SuitState[];
  princeCoatQuantity: number;
  princeCoatItems: CoatSuitState[];
  waistcoatQuantity: number;
  waistcoatItems: CoatSuitState[];
  totalAmount: string;
  totalTouched: boolean;
  advanceAmount: string;
  advanceTouched: boolean;
  // The actual Prince Coat/Waistcoat per-unit price for THIS order —
  // exclusively Settings' own configured default for a new order
  // (defaultGarmentPrices), or this order's own already-frozen historical
  // price when editing an existing one (orderData.princeCoatUnitPrice/
  // waistcoatUnitPrice) — never admin-edited anywhere in this form (no
  // per-order override; removed per explicit instruction). Only
  // meaningful/submitted while that garment's own quantity > 0.
  princeCoatUnitPrice: string;
  waistcoatUnitPrice: string;
  note: string;
  // Step 24: pure post-save navigation choice — never written to the
  // Order row, so it round-trips through the same draft object as
  // everything else here without any special-case persistence logic.
  sendOnWhatsApp: boolean;
  defaultValues: MeasurementBlockValues;
  coatDefaultValues: CoatMeasurementBlockValues;
  defaultNote: string;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/**
 * "Only bill for garments actually ordered" — a Kameez/Shalwar suit
 * counts as ordered if a Suit Type is selected OR at least one
 * measurement was entered (Kameez/Shalwar has always been priced by
 * Suit Type, never by measurements — see computeKameezTotal's own
 * comment — so a suit lacking a Suit Type but with real measurements
 * typed in is still "ordered," even though it can't suggest a price
 * yet). A suit's own effective values are its own override if "Different
 * Measurements" is on for it, otherwise the shared default block. Suit 1
 * always reads the order-level `suitType` (never its own
 * `kameezItems[0].style.suitType`, which drifts stale once the top-level
 * Suit Type changes — see handleSuitTypeChange's own comment); every
 * other suit reads its own `item.style.suitType`.
 *
 * Returns the ALREADY-FILTERED, ALREADY-RESOLVED list of just the
 * ordered suits' own Suit Types — an unordered suit (tab opened,
 * quantity defaulted to 1, nothing ever entered) contributes nothing at
 * all, rather than either being charged for or blocking the whole
 * section's total the way a genuinely-ordered-but-typeless suit still
 * correctly does (see computeKameezTotal below).
 */
function resolveOrderedKameezSuitTypes(suitType: SuitType | "", kameezItems: SuitState[], defaultValues: MeasurementBlockValues): (SuitType | "")[] {
  return kameezItems
    .map((item, index) => ({
      suitType: index === 0 ? suitType : item.style.suitType,
      values: item.override ? item.values : defaultValues,
    }))
    .filter(({ suitType: st, values }) => st !== "" || hasKameezMeasurementDataClient(values))
    .map(({ suitType: st }) => st);
}

/** Prince Coat/Waistcoat sibling of resolveOrderedKameezSuitTypes above — filters down to only the entries that actually have real measurement data for their own garment (own override if set, otherwise the shared default block). An entry relying on an empty shared default, or with a blank override, is excluded — never charged, never counted toward that garment's quantity. */
function resolveOrderedCoatItems(
  items: CoatSuitState[],
  defaultValues: CoatMeasurementBlockValues,
  hasData: (values: CoatMeasurementBlockValues) => boolean
): CoatSuitState[] {
  return items.filter((item) => hasData(item.override ? item.values : defaultValues));
}

/**
 * Step 64 — corrects Step 63's own mistake: multiplying ONE suit's price
 * by quantity assumed every suit shared the same type, which per-suit
 * overrides (Suit 2+) already made false. Total must be the SUM of each
 * individual suit's own configured default price — a Sada suit plus a
 * Ghum Silai suit is 1000+1500, never 1000×2.
 *
 * Takes the already-resolved, already-ordered-filtered list of Suit
 * Types directly (see resolveOrderedKameezSuitTypes above) — an
 * unordered suit was already excluded before this function ever sees
 * it, so every suitType it receives here genuinely IS ordered; one of
 * them lacking a Suit Type (so no configured price exists) still
 * correctly nulls out the WHOLE total rather than silently guessing —
 * the same "only ever suggest a value we actually have real data for"
 * rule the original single-suit default always followed.
 */
export function computeKameezTotal(suitTypes: (SuitType | "")[], defaultPrices: DefaultPricesMap): string | null {
  // No ordered Kameez/Shalwar suits at all costs nothing from this
  // section.
  if (suitTypes.length === 0) return "0.00";
  let sum = 0;
  for (const suitType of suitTypes) {
    // "" (Not Specified) has no configured default price, same as any
    // other suitType this map doesn't have an entry for — falls through
    // to the same "don't touch Total" return below.
    const price = suitType ? defaultPrices[suitType] : undefined;
    if (!price) return null;
    const n = Number(price);
    if (!Number.isFinite(n)) return null;
    sum += n;
  }
  return sum.toFixed(2);
}

/**
 * Three-tab Order Type redesign — Prince Coat's own quantity × its own
 * price, PLUS Waistcoat's own quantity × its own price, calculated and
 * summed independently: a garment with 0 entries contributes nothing
 * regardless of the other garment's price being set. Each array's
 * `.length` IS that garment's quantity now — no per-entry inclusion
 * resolution needed any more, since every entry in `princeCoatItems` is
 * unconditionally a Prince Coat and every entry in `waistcoatItems` is
 * unconditionally a Waistcoat (which array an entry lives in is what
 * decides its garment, not a per-entry field).
 */
export function computeCoatTotal(
  princeCoatItems: CoatSuitState[],
  waistcoatItems: CoatSuitState[],
  princeCoatUnitPrice: string,
  waistcoatUnitPrice: string
): string | null {
  const princeCoatQuantity = princeCoatItems.length;
  const waistcoatQuantity = waistcoatItems.length;
  if (princeCoatQuantity === 0 && waistcoatQuantity === 0) return "0.00";
  let sum = 0;
  if (princeCoatQuantity > 0) {
    const princePrice = Number(princeCoatUnitPrice);
    if (!Number.isFinite(princePrice)) return null;
    sum += princeCoatQuantity * princePrice;
  }
  if (waistcoatQuantity > 0) {
    const waistPrice = Number(waistcoatUnitPrice);
    if (!Number.isFinite(waistPrice)) return null;
    sum += waistcoatQuantity * waistPrice;
  }
  return sum.toFixed(2);
}

/**
 * The one combined suggested Total — still just a starting point for the
 * single editable Total field, exactly as before this upgrade; see
 * handleTotalAmountChange. Null (don't touch Total) if either section's
 * own total can't be computed yet. Takes the already-ordered-filtered
 * suit types/items directly (resolveOrderedKameezSuitTypes/
 * resolveOrderedCoatItems) — every call site resolves its own current
 * state through those first, so an unordered garment never reaches this
 * function's math at all.
 */
export function computeCombinedTotal(
  kameezSuitTypes: (SuitType | "")[],
  princeCoatItems: CoatSuitState[],
  waistcoatItems: CoatSuitState[],
  princeCoatUnitPrice: string,
  waistcoatUnitPrice: string,
  defaultPrices: DefaultPricesMap
): string | null {
  const kameezTotal = computeKameezTotal(kameezSuitTypes, defaultPrices);
  if (kameezTotal === null) return null;
  const coatTotal = computeCoatTotal(princeCoatItems, waistcoatItems, princeCoatUnitPrice, waistcoatUnitPrice);
  if (coatTotal === null) return null;
  return (Number(kameezTotal) + Number(coatTotal)).toFixed(2);
}

/** The starting style for a freshly-added suit position — a plain copy of the given values, never a shared reference (each suit must be independently editable afterward). */
function suitStyleFrom(values: {
  suitType: SuitType | "";
  collarType: CollarType | "";
  bainType: BainType | "";
  cuffType: CuffType | "";
  gheraType: GheraType | "";
  pocketOptionId: string;
}): SuitStyleState {
  return { ...values };
}

function makeInitialState(
  measurement: PrefillMeasurement | null,
  defaultPrices: DefaultPricesMap,
  coatMeasurement: PrefillCoatMeasurement | null = null,
  defaultGarmentPrices: DefaultGarmentPricesMap = { PRINCE_COAT: "", WAISTCOAT: "" }
): DraftShape {
  // Deliberately not date-derived: this is a client component, so its
  // first render also happens once on the server for the initial HTML.
  // Seeding orderDate from `new Date()` here could disagree with the
  // browser's own clock/timezone and produce a hydration mismatch. The
  // real "today" default is filled in by the mount effect below instead,
  // which only ever runs in the browser.
  // Three-tab Order Type redesign — Kameez/Shalwar still starts at 1 suit
  // and the active tab (unchanged default experience for the far more
  // common case); Prince Coat/Waistcoat both start at 0 (opt-in — most
  // orders don't include either).
  const initialKameezQuantity = 1;
  // Upgrade — Suit Type, Cuff, and Ghera now all start genuinely
  // unselected (""), same as Collar/Bain already did — "Not Specified" is
  // a real, deliberate default the admin can leave as-is or change.
  const initialStyle = suitStyleFrom({
    suitType: "",
    collarType: "",
    bainType: "",
    cuffType: "",
    gheraType: "",
    pocketOptionId: "",
  });
  const kameezItems: SuitState[] = [{ override: false, values: emptyMeasurementBlockValues(), style: initialStyle }];
  const defaultValues = measurementBlockValuesFrom(measurement);
  return {
    customerName: "",
    customerPhonePrimary: "",
    customerPhoneSecondary: "",
    customerAddress: "",
    orderDate: "",
    deliveryDate: "",
    deliveryTouched: false,
    suitType: "",
    collarType: "",
    bainType: "",
    cuffType: "",
    gheraType: "",
    pocketOptionId: "",
    pattiOptionId: "",
    panchaOptionId: "",
    // Three-tab Order Type redesign — Kameez/Shalwar is the active tab by
    // default (matches today's existing default experience exactly).
    activeOrderTab: "KAMEEZ",
    kameezQuantity: initialKameezQuantity,
    kameezItems,
    princeCoatQuantity: 0,
    princeCoatItems: [],
    waistcoatQuantity: 0,
    waistcoatItems: [],
    // Step 18: a configured Settings default price for the initially-
    // selected suit type pre-fills Total — same as if the owner had just
    // clicked that tile. Still just a starting point: typing in the
    // field (totalTouched) stops any further auto-fill immediately.
    // Step 64 — at the initial quantity of 1 this is just that one
    // suit's own price; see handleSuitTypeChange/commitKameezQuantity/
    // commitPrinceCoatQuantity/commitWaistcoatQuantity/setItemStyleField
    // for what keeps this correct as quantities change or per-suit types
    // diverge. Prince Coat/Waistcoat both start at 0, so neither
    // contributes to this initial figure.
    totalAmount:
      computeCombinedTotal(
        resolveOrderedKameezSuitTypes("", kameezItems, defaultValues),
        [],
        [],
        defaultGarmentPrices.PRINCE_COAT,
        defaultGarmentPrices.WAISTCOAT,
        defaultPrices
      ) ?? "",
    totalTouched: false,
    // Step 63 — Advance Paid now genuinely defaults to 0, not a Settings-
    // percentage-based suggestion (see the removed advanceValue/
    // computeAdvanceSuggestion logic below) and not the total.
    advanceAmount: "0.00",
    advanceTouched: false,
    // Pre-filled from Settings (requirement 1/2 — "must initially be Rs.
    // 5,000 / 3,000"); freely editable for this order only (requirement
    // 6), never writes back to Settings.
    princeCoatUnitPrice: defaultGarmentPrices.PRINCE_COAT,
    waistcoatUnitPrice: defaultGarmentPrices.WAISTCOAT,
    note: "",
    // Checked by default for a new order (design brief §9): "There is
    // also a Send on WhatsApp checkbox on the order form, checked by
    // default, because some customers give a neighbour's number."
    sendOnWhatsApp: true,
    defaultValues,
    coatDefaultValues: coatMeasurementBlockValuesFrom(coatMeasurement),
    defaultNote: measurement?.note ?? "",
  };
}

/**
 * Step 53 — seeds the form's state from an existing order (mode="edit")
 * instead of a blank/customer-measurement baseline. totalTouched/
 * advanceTouched/deliveryTouched all start `true` so the existing
 * Settings-suggestion effects (handleSuitTypeChange's default-price
 * fill, the live advance-percent suggestion, the +7-day delivery
 * default) never fire and silently overwrite a real, already-saved
 * value the moment this form mounts — those suggestions only ever make
 * sense for a genuinely blank NEW order.
 */
/**
 * Independent sections upgrade — an existing order's items are split back
 * into the two independent buckets purely by each item's own resolved
 * effective mode (`item.measurementMode ?? orderData.measurementMode`,
 * the exact same fallback order-print-data.ts already uses). This works
 * correctly for both shapes of existing data: a pre-redesign single-mode
 * order (every item shares the same mode, so one bucket gets everything
 * and the other is empty) and a post-redesign mixed order (Kameez
 * positions always precede Coat positions, so filtering preserves each
 * bucket's own relative order intact). Kameez bucket index 0 always
 * reads the order's own top-level style fields directly (never its own
 * per-item override) — true in both cases, since Coat items never
 * preceded a real Kameez position 1 under either architecture.
 */
function makeInitialStateFromOrder(orderData: OrderEditData): DraftShape {
  const orderStyle: SuitStyleState = {
    suitType: orderData.suitType,
    collarType: orderData.collarType,
    bainType: orderData.bainType,
    cuffType: orderData.cuffType,
    gheraType: orderData.gheraType,
    pocketOptionId: orderData.pocketOptionId,
  };
  const rawItems =
    orderData.items.length > 0
      ? orderData.items
      : [{ position: 1, override: false, measurement: null, coatMeasurement: null, style: null, measurementMode: null, coatGarmentSelection: "BOTH" as const }];
  const isCoatItem = (item: (typeof rawItems)[number]) => (item.measurementMode ?? orderData.measurementMode) === "COAT";
  const kameezRaw = rawItems.filter((item) => !isCoatItem(item));
  const coatRaw = rawItems.filter(isCoatItem);
  // Three-tab Order Type redesign — splits the single Coat bucket back
  // into two independent ones by each item's own already-saved
  // coatGarmentSelection (legacy NULL resolves to "BOTH", exactly as it
  // already does for pricing/display everywhere else — see
  // includesPrinceCoat/includesWaistcoat's own comment). A legacy item
  // genuinely saved as "BOTH" (only ever possible from a prior, now-
  // retired per-entry-dropdown version of this form — this feature has
  // never reached the real production database) appears in BOTH lists
  // here and, if this order is re-saved, becomes two separate entries
  // instead of one; pricing/quantities are unaffected either way (a
  // BOTH item already counted toward both garments' totals before this
  // redesign too), and this is the only way the new UI can represent it.
  const princeCoatRaw = coatRaw.filter((item) => includesPrinceCoat(item.coatGarmentSelection ?? "BOTH"));
  const waistcoatRaw = coatRaw.filter((item) => includesWaistcoat(item.coatGarmentSelection ?? "BOTH"));
  const activeOrderTab: DraftShape["activeOrderTab"] =
    kameezRaw.length > 0 ? "KAMEEZ" : princeCoatRaw.length > 0 ? "PRINCE_COAT" : waistcoatRaw.length > 0 ? "WAISTCOAT" : "KAMEEZ";

  return {
    customerName: "",
    customerPhonePrimary: "",
    customerPhoneSecondary: "",
    customerAddress: "",
    orderDate: orderData.orderDateDisplay,
    deliveryDate: orderData.deliveryDate,
    deliveryTouched: true,
    suitType: orderData.suitType,
    collarType: orderData.collarType,
    bainType: orderData.bainType,
    cuffType: orderData.cuffType,
    gheraType: orderData.gheraType,
    pocketOptionId: orderData.pocketOptionId,
    pattiOptionId: orderData.pattiOptionId,
    panchaOptionId: orderData.panchaOptionId,
    // Three-tab Order Type redesign — derived from each bucket's own
    // structural count (never from measurement content), so Edit Order
    // always opens on whichever tab this order actually has content for.
    activeOrderTab,
    kameezQuantity: kameezRaw.length,
    kameezItems: kameezRaw.map((item, index) => ({
      override: item.override,
      values: item.measurement ? measurementBlockValuesFrom(item.measurement) : emptyMeasurementBlockValues(),
      style: index === 0 ? orderStyle : suitStyleFrom(item.style ?? orderStyle),
    })),
    princeCoatQuantity: princeCoatRaw.length,
    princeCoatItems: princeCoatRaw.map((item) => ({
      override: item.override,
      values: item.coatMeasurement ? coatMeasurementBlockValuesFrom(item.coatMeasurement) : emptyCoatMeasurementBlockValues(),
    })),
    waistcoatQuantity: waistcoatRaw.length,
    waistcoatItems: waistcoatRaw.map((item) => ({
      override: item.override,
      values: item.coatMeasurement ? coatMeasurementBlockValuesFrom(item.coatMeasurement) : emptyCoatMeasurementBlockValues(),
    })),
    // Follow-up fix — previously hard-coded `true` here regardless of
    // whether the admin had actually touched Total yet, which silently
    // froze Total for the entire edit session: adding/pricing Prince
    // Coat or Waistcoat items during an edit never recalculated it,
    // since every totalAmount-recompute site below is gated on
    // `!prev.totalTouched`. Starting `false` here (same as a new order)
    // restores live recalculation until the admin actually types into
    // Total themselves (handleTotalAmountChange sets this true) — the
    // initial `totalAmount` value above is untouched either way, so
    // simply opening Edit Order still never changes it by itself.
    totalAmount: orderData.totalAmount,
    totalTouched: false,
    advanceAmount: orderData.advanceAmount,
    advanceTouched: true,
    princeCoatUnitPrice: orderData.princeCoatUnitPrice,
    waistcoatUnitPrice: orderData.waistcoatUnitPrice,
    note: orderData.note,
    sendOnWhatsApp: false, // unused — the checkbox is hidden entirely in mode="edit"
    defaultValues: measurementBlockValuesFrom(orderData.defaultMeasurement),
    coatDefaultValues: coatMeasurementBlockValuesFrom(orderData.defaultCoatMeasurement),
    defaultNote: orderData.defaultNote,
  };
}

export function OrderForm({
  mode = "existing",
  customerId,
  customerExists = false,
  measurement,
  coatMeasurement = null,
  pocketOptions,
  pattiOptions,
  panchaOptions,
  error,
  defaultAdvancePercent = null,
  defaultPrices = {},
  defaultGarmentPrices = { PRINCE_COAT: "", WAISTCOAT: "" },
  orderData,
}: {
  /** Step 25 — "new" renders the editable customer-info block and submits through createCustomerAndOrder. Step 53 adds "edit" — an existing order's own values, submitted through enqueueUpdateOrder. Defaults to the original "existing" behaviour, unchanged. Phase 6 made "existing" local-first (see handleSubmit below) — "new" is unchanged, still Server-Action-submitted. */
  mode?: "existing" | "new" | "edit";
  /** Required for mode="existing"/"edit" (an existing customer's id); ignored in mode="new", where no customer exists yet. */
  customerId?: string;
  /** Phase 6 — mode="existing" only: from the server-rendered page's own Prisma read, whether Postgres has a (non-deleted) customer row for this id yet. A customer created offline and not yet synced has none, but may still exist locally (see the mount effect below). Ignored in mode="new"/"edit" (an order can only be edited once it exists server-side — see the Edit Order page's own comment). */
  customerExists?: boolean;
  measurement: PrefillMeasurement | null;
  /** Coat-mode sibling of `measurement` above — the customer's saved Prince Coat/Waistcoat profile, or null for a customer with none yet. */
  coatMeasurement?: PrefillCoatMeasurement | null;
  pocketOptions: DesignOption[];
  /** Step 57 — Patti Style options, same shape/source as pocketOptions (DesignOptionCategory.PATTI). Order-level only — see DraftShape's own comment on why there's no per-suit equivalent. */
  pattiOptions: DesignOption[];
  /** Pancha Style options, same shape/source (DesignOptionCategory.PANCHA). Order-level only, same as pattiOptions. */
  panchaOptions: DesignOption[];
  error?: string;
  /** Settings (Step 18) — a configured default advance %, or null if none is set. Only ever suggests a starting value; never forces one. Ignored in mode="edit" (advanceTouched starts true — see makeInitialStateFromOrder). */
  defaultAdvancePercent?: string | null;
  /** Settings (Step 18) — configured default total per suit type, where set. Ignored in mode="edit" for the same reason. */
  defaultPrices?: DefaultPricesMap;
  /** Settings — configured default Prince Coat/Waistcoat unit prices (requirement 1/2's Rs. 5,000/3,000). Ignored in mode="edit" (the order's own already-frozen princeCoatUnitPrice/waistcoatUnitPrice are used instead). */
  defaultGarmentPrices?: DefaultGarmentPricesMap;
  /** Required for mode="edit" — the order's current values to seed the form with. Ignored otherwise. */
  orderData?: OrderEditData;
}) {
  const isNewCustomer = mode === "new";
  const isEdit = mode === "edit";
  const router = useRouter();
  // Step 25: the localStorage draft key for mode="new" is the fixed
  // string "new" — real customer ids are always cuids (e.g.
  // "cmt...") and can never collide with that literal, so a brand-new-
  // customer draft can never overwrite or be confused with any existing
  // customer's draft, and vice versa. order-draft-storage.ts itself is
  // untouched — it already takes an opaque string key.
  //
  // Step 53 — mode="edit" uses its own "edit:<orderId>" namespace, so an
  // in-progress edit's draft can never collide with (or be confused for)
  // a separate "create a new order for this same customer" draft, which
  // already uses the bare customerId key.
  const draftKey = isNewCustomer ? "new" : isEdit ? `edit:${orderData!.orderId}` : customerId!;
  // Follow-up fix — mode="new" used to submit natively through this
  // Server Action (a real browser form POST with no JS result to act
  // on), so the local Dexie mirror never got a row for the newly-created
  // order at all until the next full page load's initial-sync pull — an
  // immediate status change had no local baseline to protect and failed
  // closed. handleSubmit below now intercepts this mode too, calls the
  // action directly, and hydrates Dexie from its authoritative result
  // before navigating — so no mode needs this native `action` prop
  // anymore.
  const formRef = useRef<HTMLFormElement>(null);

  const [state, setState] = useState<DraftShape>(() =>
    isEdit ? makeInitialStateFromOrder(orderData!) : makeInitialState(measurement, defaultPrices, coatMeasurement, defaultGarmentPrices)
  );
  const [defaultActiveField, setDefaultActiveField] = useState("length");
  const [itemActiveFields, setItemActiveFields] = useState<string[]>(["length"]);
  // Three-tab Order Type redesign — Prince Coat and Waistcoat entries are
  // each their own wholly separate list from Kameez/Shalwar suits (and
  // from each other), so each needs its own parallel active-field
  // tracker rather than sharing itemActiveFields' indices (which would
  // collide across all three lists otherwise).
  const [princeCoatItemActiveFields, setPrinceCoatItemActiveFields] = useState<string[]>([]);
  const [waistcoatItemActiveFields, setWaistcoatItemActiveFields] = useState<string[]>([]);
  const [defaultCoatActiveField, setDefaultCoatActiveField] = useState("");
  // Step 50 — the quantity inputs' own displayed text, deliberately
  // decoupled from the committed state.kameezQuantity/state.princeCoatQuantity/
  // state.waistcoatQuantity (see handleKameezQuantityTextChange/
  // handlePrinceCoatQuantityTextChange/handleWaistcoatQuantityTextChange
  // below). Three independent text states, seeded from `state`'s own
  // already-computed quantities (it was just initialized above, so this
  // reads the real starting values for either mode="edit" or a fresh
  // order).
  const [kameezQuantityText, setKameezQuantityText] = useState(() => String(state.kameezQuantity));
  const [princeCoatQuantityText, setPrinceCoatQuantityText] = useState(() => String(state.princeCoatQuantity));
  const [waistcoatQuantityText, setWaistcoatQuantityText] = useState(() => String(state.waistcoatQuantity));
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
  const sectionIds = isNewCustomer
    ? ["customer", "orderType", "kameez", "princeCoat", "waistcoat", "payment"]
    : ["orderType", "kameez", "princeCoat", "waistcoat", "payment"];
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
    // A draft saved before this exact shape existed (the old shared
    // `items`/`quantity`, or the previous checkbox-era
    // orderTypeKameez/orderTypeCoat/coatItems shape) is simply not
    // restorable into the new three-tab shape; treated exactly like "no
    // draft" rather than attempting a lossy reconstruction. Zero
    // real-world risk: this feature has never reached the real
    // production database or an actual admin's browser yet.
    const draftUnknown = draft as unknown as { kameezItems?: unknown; princeCoatItems?: unknown; waistcoatItems?: unknown };
    if (draft && Array.isArray(draftUnknown.kameezItems) && Array.isArray(draftUnknown.princeCoatItems) && Array.isArray(draftUnknown.waistcoatItems)) {
      // A draft saved before Step 24 has no sendOnWhatsApp key at all —
      // `undefined` would silently read as unchecked. Defaulting a
      // genuinely-missing key to true (not overriding an explicit false
      // from a newer draft) keeps the "checked by default" rule honest
      // for that one narrow case without touching how every other field
      // already round-trips through this same object.
      const normalized = {
        ...draft,
        sendOnWhatsApp: draft.sendOnWhatsApp === undefined ? true : draft.sendOnWhatsApp,
        // Step 57 — a draft saved before this step has no pattiOptionId
        // key at all (the field didn't exist yet); same "missing key
        // defaults to the harmless empty value" treatment sendOnWhatsApp
        // gets above, not the "restore whatever's there" treatment every
        // pre-existing field gets via the spread.
        pattiOptionId: draft.pattiOptionId ?? "",
        panchaOptionId: draft.panchaOptionId ?? "",
        activeOrderTab: draft.activeOrderTab ?? "KAMEEZ",
        coatDefaultValues: draft.coatDefaultValues ?? emptyCoatMeasurementBlockValues(),
        princeCoatItems: draft.princeCoatItems.map((item) => ({ ...item, values: item.values ?? emptyCoatMeasurementBlockValues() })),
        waistcoatItems: draft.waistcoatItems.map((item) => ({ ...item, values: item.values ?? emptyCoatMeasurementBlockValues() })),
        princeCoatUnitPrice: draft.princeCoatUnitPrice ?? "",
        waistcoatUnitPrice: draft.waistcoatUnitPrice ?? "",
        // Step 50 — a draft saved before this step has items with no
        // `style` key at all (per-suit style didn't exist yet). Backfilling
        // it from that same draft's own suit-1 style keeps an old,
        // mid-edit draft safely restorable instead of crashing on the new
        // per-suit style blocks below.
        kameezItems: draft.kameezItems.map((item) => ({
          ...item,
          style:
            item.style ??
            suitStyleFrom({
              suitType: draft.suitType,
              collarType: draft.collarType,
              bainType: draft.bainType,
              cuffType: draft.cuffType,
              gheraType: draft.gheraType,
              pocketOptionId: draft.pocketOptionId,
            }),
        })),
      };
      setState(normalized);
      setKameezQuantityText(String(normalized.kameezQuantity));
      setPrinceCoatQuantityText(String(normalized.princeCoatQuantity));
      setWaistcoatQuantityText(String(normalized.waistcoatQuantity));
      setItemActiveFields(normalized.kameezItems.map(() => "length"));
      setPrinceCoatItemActiveFields(normalized.princeCoatItems.map(() => ""));
      setWaistcoatItemActiveFields(normalized.waistcoatItems.map(() => ""));
      setDraftRestored(true);
    } else if (!isEdit) {
      // Step 53 — mode="edit" already seeded orderDate/deliveryDate from
      // the order's own real values (makeInitialStateFromOrder); this
      // "no draft yet" fallback only makes sense for a genuinely blank
      // new order, so it's skipped entirely in edit mode rather than
      // overwriting those real dates with today's.
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

  /** Grows/shrinks state.kameezItems (and itemActiveFields) to exactly `n` entries. A newly-added suit starts as a copy of suit 1's CURRENT style — see suitStyleFrom's comment — and is independently editable from then on. Entirely independent of the Prince Coat/Waistcoat sections below — changing this never touches princeCoatQuantity/princeCoatItems/waistcoatQuantity/waistcoatItems. */
  function commitKameezQuantity(n: number) {
    setState((prev) => {
      const kameezItems = prev.kameezItems.slice(0, n);
      while (kameezItems.length < n) {
        kameezItems.push({
          override: false,
          values: emptyMeasurementBlockValues(),
          style: suitStyleFrom({
            suitType: prev.suitType,
            collarType: prev.collarType,
            bainType: prev.bainType,
            cuffType: prev.cuffType,
            gheraType: prev.gheraType,
            pocketOptionId: prev.pocketOptionId,
          }),
        });
      }
      // Step 64 — Total = SUM of each individual suit's own price, not
      // one price × quantity (a newly-added suit starts as a copy of
      // suit 1's type, so growing quantity still sums correctly until
      // the owner changes one of the new suits' own type). Only ever
      // recomputes a still-untouched Total, same "starting point, never
      // overwrite a real edit" rule handleSuitTypeChange's own price
      // fill already follows.
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(prev.princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(prev.waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, kameezQuantity: n, kameezItems, totalAmount };
    });
    setItemActiveFields((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("length");
      return next;
    });
  }

  /** Prince Coat sibling of commitKameezQuantity above — grows/shrinks state.princeCoatItems (and princeCoatItemActiveFields) to exactly `n` entries. Entirely independent of Kameez/Shalwar and Waistcoat — changing this never touches either. */
  function commitPrinceCoatQuantity(n: number) {
    setState((prev) => {
      const princeCoatItems = prev.princeCoatItems.slice(0, n);
      while (princeCoatItems.length < n) {
        princeCoatItems.push({ override: false, values: emptyCoatMeasurementBlockValues() });
      }
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(prev.waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, princeCoatQuantity: n, princeCoatItems, totalAmount };
    });
    setPrinceCoatItemActiveFields((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
  }

  /** Waistcoat sibling of commitPrinceCoatQuantity above, operating on state.waistcoatItems instead. */
  function commitWaistcoatQuantity(n: number) {
    setState((prev) => {
      const waistcoatItems = prev.waistcoatItems.slice(0, n);
      while (waistcoatItems.length < n) {
        waistcoatItems.push({ override: false, values: emptyCoatMeasurementBlockValues() });
      }
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(prev.princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, waistcoatQuantity: n, waistcoatItems, totalAmount };
    });
    setWaistcoatItemActiveFields((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
  }

  /**
   * Three-tab Order Type redesign — clicking a tab only ever changes
   * which section is currently VISIBLE (`activeOrderTab`); it never
   * touches any of the three quantities/item lists, so switching tabs
   * can never deselect or lose a previously-added order type. The one
   * exception: clicking a tab whose own quantity is still 0 (never
   * added yet) commits it to 1, so the tab doesn't open on an empty
   * section with nothing to fill in. Clicking a tab that already has a
   * quantity > 0 leaves it exactly as it was.
   */
  function handleOrderTabClick(tab: DraftShape["activeOrderTab"]) {
    setState((prev) => ({ ...prev, activeOrderTab: tab }));
    if (tab === "KAMEEZ" && state.kameezQuantity === 0) {
      commitKameezQuantity(1);
      setKameezQuantityText("1");
    } else if (tab === "PRINCE_COAT" && state.princeCoatQuantity === 0) {
      commitPrinceCoatQuantity(1);
      setPrinceCoatQuantityText("1");
    } else if (tab === "WAISTCOAT" && state.waistcoatQuantity === 0) {
      commitWaistcoatQuantity(1);
      setWaistcoatQuantityText("1");
    }
  }

  // Step 50 (requirement #4) — each quantity input's own text is tracked
  // separately from its committed state.*Quantity/state.*Items so the
  // field can be fully cleared, or briefly hold an out-of-range number,
  // while typing without anything snapping back mid-edit. A value that is
  // ALREADY a valid 0-20 integer commits immediately ("1 -> 2 immediately
  // shows 2 suits"); anything else (blank, out of range, non-numeric)
  // simply doesn't commit yet — the last valid committed quantity is left
  // exactly as it was until the matching blur handler normalizes it.
  // Independent sections upgrade — 0 is now a valid floor for BOTH (not
  // just Coat): "Kameez/Shalwar only", "Coat/Waistcoat only", and "both"
  // must all be reachable, so neither section can have a hard floor of 1
  // any more.
  function handleKameezQuantityTextChange(raw: string) {
    setKameezQuantityText(raw);
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n >= 0 && n <= 20) {
        commitKameezQuantity(n);
      }
    }
  }

  /** On blur (the "save/commit" point, requirement #4): a blank field normalizes to 0; anything else clamps into the valid 0-20 range. Never runs while still typing. */
  function handleKameezQuantityBlur() {
    const trimmed = kameezQuantityText.trim();
    const n = trimmed === "" ? 0 : Math.max(0, Math.min(20, parseInt(trimmed, 10) || 0));
    commitKameezQuantity(n);
    setKameezQuantityText(String(n));
  }

  function handlePrinceCoatQuantityTextChange(raw: string) {
    setPrinceCoatQuantityText(raw);
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n >= 0 && n <= 20) {
        commitPrinceCoatQuantity(n);
      }
    }
  }

  function handlePrinceCoatQuantityBlur() {
    const trimmed = princeCoatQuantityText.trim();
    const n = trimmed === "" ? 0 : Math.max(0, Math.min(20, parseInt(trimmed, 10) || 0));
    commitPrinceCoatQuantity(n);
    setPrinceCoatQuantityText(String(n));
  }

  function handleWaistcoatQuantityTextChange(raw: string) {
    setWaistcoatQuantityText(raw);
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n >= 0 && n <= 20) {
        commitWaistcoatQuantity(n);
      }
    }
  }

  function handleWaistcoatQuantityBlur() {
    const trimmed = waistcoatQuantityText.trim();
    const n = trimmed === "" ? 0 : Math.max(0, Math.min(20, parseInt(trimmed, 10) || 0));
    commitWaistcoatQuantity(n);
    setWaistcoatQuantityText(String(n));
  }

  function toggleOverride(position: number, on: boolean) {
    setState((prev) => {
      const kameezItems = [...prev.kameezItems];
      kameezItems[position - 1] = { ...kameezItems[position - 1], override: on };
      return { ...prev, kameezItems };
    });
  }

  function setItemFieldValue(position: number, key: string, value: string) {
    setState((prev) => {
      const kameezItems = [...prev.kameezItems];
      kameezItems[position - 1] = { ...kameezItems[position - 1], values: { ...kameezItems[position - 1].values, [key]: value } };
      return { ...prev, kameezItems };
    });
  }

  /**
   * Prince Coat sibling of toggleOverride above, operating on
   * state.princeCoatItems instead. Toggling "Different Measurements"
   * changes which values are EFFECTIVE for this entry (its own override
   * vs. the shared default), which can flip whether it counts as
   * "ordered" (see resolveOrderedCoatItems) — so the still-untouched
   * suggested Total must recompute here too, same as every other edit
   * that can change a garment's own ordered status.
   */
  function togglePrinceCoatOverride(position: number, on: boolean) {
    setState((prev) => {
      const princeCoatItems = [...prev.princeCoatItems];
      princeCoatItems[position - 1] = { ...princeCoatItems[position - 1], override: on };
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(prev.waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, princeCoatItems, totalAmount };
    });
  }

  /**
   * Prince Coat sibling of setItemFieldValue above, operating on
   * state.princeCoatItems instead. Unlike Kameez/Shalwar (priced by Suit
   * Type, never by measurements), Prince Coat/Waistcoat ARE priced
   * purely by how many entries actually have real data — typing the
   * first real value into an entry is exactly the edit that flips it
   * from "doesn't count" to "counts at full price," so the
   * still-untouched suggested Total must recompute on every keystroke
   * here, not just on quantity/toggle changes.
   */
  function setPrinceCoatItemFieldValue(position: number, key: string, value: string) {
    setState((prev) => {
      const princeCoatItems = [...prev.princeCoatItems];
      princeCoatItems[position - 1] = { ...princeCoatItems[position - 1], values: { ...princeCoatItems[position - 1].values, [key]: value } };
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(prev.waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, princeCoatItems, totalAmount };
    });
  }

  /** Waistcoat sibling of togglePrinceCoatOverride above, operating on state.waistcoatItems instead — same reasoning. */
  function toggleWaistcoatOverride(position: number, on: boolean) {
    setState((prev) => {
      const waistcoatItems = [...prev.waistcoatItems];
      waistcoatItems[position - 1] = { ...waistcoatItems[position - 1], override: on };
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(prev.princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, waistcoatItems, totalAmount };
    });
  }

  /** Waistcoat sibling of setPrinceCoatItemFieldValue above, operating on state.waistcoatItems instead — same reasoning. */
  function setWaistcoatItemFieldValue(position: number, key: string, value: string) {
    setState((prev) => {
      const waistcoatItems = [...prev.waistcoatItems];
      waistcoatItems[position - 1] = { ...waistcoatItems[position - 1], values: { ...waistcoatItems[position - 1].values, [key]: value } };
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(prev.princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, waistcoatItems, totalAmount };
    });
  }

  /**
   * The shared Prince Coat/Waistcoat default measurement block's own
   * onChange — one function used by BOTH the Prince Coat section's and
   * the Waistcoat section's shared block (they both read/write the same
   * state.coatDefaultValues object; see schema.prisma's own comment on
   * why one object can hold both groups' disjoint fields at once).
   * Typing the first real value here is exactly the edit that can flip
   * a non-overridden entry from "doesn't count" to "counts" for EITHER
   * garment (whichever one has at least one non-overridden entry relying
   * on this shared block), so the still-untouched suggested Total must
   * recompute here too.
   */
  function setCoatDefaultValue(key: string, value: string) {
    setState((prev) => {
      const coatDefaultValues = { ...prev.coatDefaultValues, [key]: value };
      const totalAmount = !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(prev.suitType, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(prev.princeCoatItems, coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(prev.waistcoatItems, coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount;
      return { ...prev, coatDefaultValues, totalAmount };
    });
  }

  /** Suit 2+'s own style (requirement #6/#8) — position 1 is never touched here; its style is the top-level suitType/collarType/... state, updated via handleSuitTypeChange/update() exactly as before. */
  function setItemStyleField<K extends keyof SuitStyleState>(position: number, key: K, value: SuitStyleState[K]) {
    setState((prev) => {
      const kameezItems = [...prev.kameezItems];
      kameezItems[position - 1] = { ...kameezItems[position - 1], style: { ...kameezItems[position - 1].style, [key]: value } };
      // Step 64 — a per-suit Suit Type change also changes that suit's
      // own price, so Total (still a SUM across every suit) needs the
      // same still-untouched-only recompute every other suitType change
      // already gets. No other per-suit field (collar/bain/cuff/ghera/
      // pocket) affects price, so this only fires for "suitType".
      const totalAmount =
        key === "suitType" && !prev.totalTouched
          ? (computeCombinedTotal(
              resolveOrderedKameezSuitTypes(prev.suitType, kameezItems, prev.defaultValues),
              resolveOrderedCoatItems(prev.princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
              resolveOrderedCoatItems(prev.waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
              prev.princeCoatUnitPrice,
              prev.waistcoatUnitPrice,
              defaultPrices
            ) ?? prev.totalAmount)
          : prev.totalAmount;
      return { ...prev, kameezItems, totalAmount };
    });
  }

  // Step 63 — Collar and Bain are one combined choice: picking a Collar
  // always clears any selected Bain, and vice versa, so at most one of
  // the two is ever set. Order-level (suit 1) pair — position 2+'s own
  // pair is setItemCollarField/setItemBainField just below.
  function handleCollarChange(value: CollarType | "") {
    setState((prev) => ({ ...prev, collarType: value, bainType: "" }));
  }
  function handleBainChange(value: BainType | "") {
    setState((prev) => ({ ...prev, bainType: value, collarType: "" }));
  }
  function setItemCollarField(position: number, value: CollarType | "") {
    setState((prev) => {
      const kameezItems = [...prev.kameezItems];
      kameezItems[position - 1] = { ...kameezItems[position - 1], style: { ...kameezItems[position - 1].style, collarType: value, bainType: "" } };
      return { ...prev, kameezItems };
    });
  }
  function setItemBainField(position: number, value: BainType | "") {
    setState((prev) => {
      const kameezItems = [...prev.kameezItems];
      kameezItems[position - 1] = { ...kameezItems[position - 1], style: { ...kameezItems[position - 1].style, bainType: value, collarType: "" } };
      return { ...prev, kameezItems };
    });
  }

  function discardDraft() {
    clearOrderDraft(draftKey);
    const fresh = isEdit ? makeInitialStateFromOrder(orderData!) : makeInitialState(measurement, defaultPrices, coatMeasurement, defaultGarmentPrices);
    setState(fresh);
    setItemActiveFields(["length"]);
    setPrinceCoatItemActiveFields(fresh.princeCoatItems.map(() => ""));
    setWaistcoatItemActiveFields(fresh.waistcoatItems.map(() => ""));
    setKameezQuantityText(String(fresh.kameezQuantity));
    setPrinceCoatQuantityText(String(fresh.princeCoatQuantity));
    setWaistcoatQuantityText(String(fresh.waistcoatQuantity));
    setDraftRestored(false);
  }

  function handleSuitTypeChange(value: SuitType | "") {
    setState((prev) => ({
      ...prev,
      suitType: value,
      // Only ever fills a blank/not-yet-touched Total — never overwrites
      // something the owner already typed, and never clears a value down
      // to blank just because the newly-selected type has no configured
      // default price. Step 64 — sums suit 1's NEW price with every
      // other suit's own unchanged price, same rule commitKameezQuantity's
      // own totalAmount recompute follows.
      totalAmount: !prev.totalTouched
        ? (computeCombinedTotal(
            resolveOrderedKameezSuitTypes(value, prev.kameezItems, prev.defaultValues),
            resolveOrderedCoatItems(prev.princeCoatItems, prev.coatDefaultValues, hasPrinceCoatMeasurementDataClient),
            resolveOrderedCoatItems(prev.waistcoatItems, prev.coatDefaultValues, hasWaistcoatMeasurementDataClient),
            prev.princeCoatUnitPrice,
            prev.waistcoatUnitPrice,
            defaultPrices
          ) ?? prev.totalAmount)
        : prev.totalAmount,
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
  // mode="new" — see the follow-up fix comment inside handleSubmit's own
  // isNewCustomer branch below for why this now intercepts and calls
  // createCustomerAndOrder directly instead of a native form submission.
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
    if (isNewCustomer) {
      // Follow-up fix — now intercepted and called directly (previously
      // a native browser form POST with no JS result to act on).
      // createCustomerAndOrder() never calls redirect() itself anymore —
      // it always returns a plain, predictable, discriminated result —
      // so there is no ambiguity left to resolve here; a validation
      // failure is a genuine, explicit `{ok:false}` value, exactly like
      // every other branch in this component already handles.
      event.preventDefault();
      setLocalError(null);
      setSubmitting(true);
      const formData = new FormData(event.currentTarget);
      const result = await createCustomerAndOrder(formData);

      if (!result.ok) {
        setLocalError(result.error);
        setSubmitting(false);
        return;
      }

      // Hydrate the local Dexie mirror with the AUTHORITATIVE server
      // result before navigating — this is what lets an immediate status
      // change right after creation find a real baseline instead of
      // failing closed. Deliberately a thin row: nothing currently reads
      // deep order/customer content from the local mirror for rendering
      // (Order Board/Detail/Customer Profile are all server-rendered),
      // only syncStatus/status/baseUpdatedAt matter here — so every other
      // field is a safe, honest default rather than a guess.
      if (isOfflineDbAvailable()) {
        try {
          const db = getOfflineDb();
          await db.transaction("rw", [db.customers, db.orders], async () => {
            await db.customers.put({
              id: result.customerId,
              customerCode: result.customerCode,
              name: state.customerName,
              phonePrimary: state.customerPhonePrimary,
              phoneSecondary: state.customerPhoneSecondary || null,
              address: state.customerAddress || null,
              deletedAt: null,
              createdById: null,
              createdAt: result.customerUpdatedAt,
              updatedAt: result.customerUpdatedAt,
              baseUpdatedAt: result.customerUpdatedAt,
              syncStatus: "synced",
            });
            await db.orders.put({
              id: result.orderId,
              orderNumber: result.orderNumber,
              customerId: result.customerId,
              orderDate: new Date(String(formData.get("orderDate"))).toISOString(),
              deliveryDate: null,
              measurementMode: "KAMEEZ_SHALWAR",
              suitType: null,
              collarType: null,
              bainType: null,
              cuffType: null,
              gheraType: null,
              pocketOptionId: null,
              pattiOptionId: null,
              panchaOptionId: null,
              defaultMeasurementSnapshotId: null,
              totalAmount: state.totalAmount,
              advanceAmount: state.advanceAmount,
              balanceAmount: calculateBalance(state.totalAmount, state.advanceAmount),
              princeCoatUnitPrice: null,
              waistcoatUnitPrice: null,
              status: result.orderStatus as OrderStatus,
              createdById: null,
              note: null,
              createdAt: result.orderUpdatedAt,
              updatedAt: result.orderUpdatedAt,
              baseUpdatedAt: result.orderUpdatedAt,
              syncStatus: "synced",
            });
          });
        } catch {
          // Best-effort only — if this fails, the admin just needs one
          // refresh before the status can be changed, same as the
          // pre-fix behavior; never block navigation on it.
        }
      }

      clearOrderDraft(draftKey);
      router.push(result.redirectUrl);
      return;
    }

    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);

    // Step 53 — Edit Order: a separate, simpler branch. Unlike creation,
    // there is no print-preview destination to race a live sync against
    // (S5 only ever makes sense for a brand-new order) — every save
    // always lands back on this same order's own detail page, whether or
    // not the sync happened to finish before navigation. That page
    // itself may briefly show pre-edit values if it renders before the
    // background sync completes (or while offline) — the same
    // "server-rendered page can lag a pending local edit" characteristic
    // every local-first form in this app already accepts (e.g.
    // edit-customer-form.tsx's own navigateAfterLocalSave, also
    // fire-and-forget on the sync) — OrderPendingEditNotice on that page
    // says so honestly rather than silently showing stale data as current.
    if (isEdit) {
      const result = await enqueueUpdateOrder(customerId!, orderData!.orderId, formData);
      if (!result.queued) {
        setLocalError(result.message ?? "Could not save changes.");
        setSubmitting(false);
        return;
      }
      // Cleared only now that the local save is actually confirmed — a
      // failed save (storage error or otherwise) must never destroy
      // this crash-recovery draft; the user needs to be able to retry
      // from it.
      clearOrderDraft(draftKey);
      processSyncQueue().catch(() => {});
      navigateAfterLocalSave(router, `/customers/${customerId}/orders/${orderData!.orderId}`);
      return;
    }

    const result = await enqueueCreateOrder(customerId!, formData);
    if (!result.queued || !result.id) {
      setLocalError(result.message ?? "Could not save order.");
      setSubmitting(false);
      return;
    }
    // Same reasoning as the edit branch above.
    clearOrderDraft(draftKey);
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

  // Step 63 — Advance Paid no longer has a live-computed Settings-
  // percentage suggestion; it genuinely defaults to 0.00 (see
  // makeInitialState) and only ever changes when the owner types into it
  // themselves. `defaultAdvancePercent` is still accepted as a prop
  // (every caller still passes it; removing the plumbing would be an
  // unrelated change) but is no longer consulted here.
  const balance = MONEY_REGEX.test(state.totalAmount) && MONEY_REGEX.test(state.advanceAmount)
    ? calculateBalance(state.totalAmount, state.advanceAmount)
    : null;
  const advanceExceedsTotal =
    MONEY_REGEX.test(state.totalAmount) && MONEY_REGEX.test(state.advanceAmount)
      ? !isAdvanceWithinTotal(state.totalAmount, state.advanceAmount)
      : false;

  // Payment section breakdown — purely informational (requirement 4),
  // feeding the one real editable/submitted Total exactly the way the
  // existing "Suggested from..." hint already does. "Only bill for
  // garments actually ordered" — every quantity/total below is computed
  // from the ALREADY-ORDERED-FILTERED lists (resolveOrderedKameezSuitTypes/
  // resolveOrderedCoatItems), never the raw state.*Quantity/*Items — a
  // tab that was opened (defaulting its quantity to 1) but never filled
  // in correctly contributes nothing here, exactly matching what Receipt/
  // Order Detail/Work Order will show once saved. state.princeCoatQuantity/
  // state.waistcoatQuantity (the RAW, admin-set quantities) are still used
  // separately, only to decide whether the Payment section's price input
  // for that garment appears at all — see the Payment section below.
  const orderedKameezSuitTypes = resolveOrderedKameezSuitTypes(state.suitType, state.kameezItems, state.defaultValues);
  const orderedPrinceCoatItems = resolveOrderedCoatItems(state.princeCoatItems, state.coatDefaultValues, hasPrinceCoatMeasurementDataClient);
  const orderedWaistcoatItems = resolveOrderedCoatItems(state.waistcoatItems, state.coatDefaultValues, hasWaistcoatMeasurementDataClient);
  const kameezTotal = computeKameezTotal(orderedKameezSuitTypes, defaultPrices);
  const princeCoatQuantity = orderedPrinceCoatItems.length;
  const waistcoatQuantity = orderedWaistcoatItems.length;
  const princeCoatTotal =
    princeCoatQuantity > 0 && Number.isFinite(Number(state.princeCoatUnitPrice))
      ? (princeCoatQuantity * Number(state.princeCoatUnitPrice)).toFixed(2)
      : null;
  const waistcoatTotal =
    waistcoatQuantity > 0 && Number.isFinite(Number(state.waistcoatUnitPrice))
      ? (waistcoatQuantity * Number(state.waistcoatUnitPrice)).toFixed(2)
      : null;
  const combinedSuggestedTotal = computeCombinedTotal(
    orderedKameezSuitTypes,
    orderedPrinceCoatItems,
    orderedWaistcoatItems,
    state.princeCoatUnitPrice,
    state.waistcoatUnitPrice,
    defaultPrices
  );

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
          of scroll position or which pill is active.
          Nav-link visibility fix — only the garment-type id matching the
          CURRENTLY ACTIVE tab gets a pill here; customer/orderType/payment
          (absent from GARMENT_SECTION_TAB) always do. This filters the
          rendered pills only — sectionIds itself (below, and the
          IntersectionObserver effect's own one-time snapshot of it) stays
          exactly as it was, since the garment SECTIONS themselves are
          still all simultaneously present in the DOM (CSS-hidden, not
          unmounted) and still need to be observable for scroll-spy
          regardless of which pill is currently shown. Recomputed on every
          render, so the nav updates the instant activeOrderTab changes —
          no extra state needed. */}
      <nav aria-label="Order form sections" className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-sm border border-rule bg-card p-1.5 shadow-sm">
        {sectionIds
          .filter((id) => {
            const requiredTab = GARMENT_SECTION_TAB[id];
            return requiredTab === undefined || requiredTab === state.activeOrderTab;
          })
          .map((id) => (
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
                {/* Same duplicate-phone warning the customer-only form
                    shows (new-customer-form.tsx). This combined flow is
                    the primary way customers get created, so leaving it
                    out here would have missed most duplicates. Renders
                    nothing until the number is long enough to be a real
                    match, and never blocks the save. */}
                <DuplicatePhoneNotice phone={state.customerPhonePrimary} />
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

      {/* Order Type Selection — three independent, clickable tabs. Which
          tab is CURRENTLY VISIBLE (state.activeOrderTab) is a separate
          concept from which order type(s) are actually part of this
          order (that's purely each type's own quantity > 0, below) —
          clicking a tab only ever navigates; it never deselects or
          clears another tab's own quantity/measurements. Each button's
          small badge shows that type's current quantity, so the admin
          can see what's already been added without needing to be on
          that tab. */}
      <SectionCard id="orderType" title={en.orderForm.orderTypeHeading}>
        <p className="-mt-1 mb-3 text-xs text-graphite/50">{en.orderForm.orderTypeHint}</p>
        {/* grid-cols-3 (not flex) so all three options always occupy
            exactly 100% of the available width, equally split — the
            whole point being no leftover empty space and no
            shrink-to-content sizing. Grid rows stretch their children to
            equal height by default, so all three cards match height
            too, regardless of label length. */}
        <div className="grid grid-cols-3 gap-3">
          {/* Badge counts — the number of GENUINELY COMPLETED measurement
              sets (same existing "has real data" rule that already
              drives billing: Suit Type selected or a measurement entered
              for Kameez/Shalwar; a real measurement entered, own
              override or shared default, for Prince Coat/Waistcoat), not
              the raw admin-set quantity (which defaults to 1 the moment
              a tab is first opened, before anything is filled in). */}
          <OrderTypeTabButton
            label={en.orderForm.orderTypeKameezLabel}
            selected={state.activeOrderTab === "KAMEEZ"}
            quantity={orderedKameezSuitTypes.length}
            onSelect={() => handleOrderTabClick("KAMEEZ")}
          />
          <OrderTypeTabButton
            label={en.orderForm.orderTypePrinceCoatLabel}
            selected={state.activeOrderTab === "PRINCE_COAT"}
            quantity={orderedPrinceCoatItems.length}
            onSelect={() => handleOrderTabClick("PRINCE_COAT")}
          />
          <OrderTypeTabButton
            label={en.orderForm.orderTypeWaistcoatLabel}
            selected={state.activeOrderTab === "WAISTCOAT"}
            quantity={orderedWaistcoatItems.length}
            onSelect={() => handleOrderTabClick("WAISTCOAT")}
          />
        </div>
      </SectionCard>

      {/* Kameez/Shalwar Order — fully independent of Prince Coat/Waistcoat
          below: its own count, its own measurements/styles, its own
          "different measurements" override. Nothing here is gated on,
          or affects, either Coat section. Always mounted (CSS-hidden,
          never unmounted) so its real quantity/measurements always
          submit regardless of which tab is currently visible — switching
          tabs must never drop this section's data from the save. */}
      <div className={state.activeOrderTab === "KAMEEZ" ? undefined : "hidden"}>
      <SectionCard id="kameez" title={en.orderForm.kameezShalwarOrder}>
        <div>
          <label htmlFor="kameezQuantity" className="block text-sm font-medium text-graphite">
            {en.orderForm.quantity}
          </label>
          <input
            id="kameezQuantity"
            type="text"
            inputMode="numeric"
            value={kameezQuantityText}
            onChange={(event) => handleKameezQuantityTextChange(event.target.value)}
            onBlur={handleKameezQuantityBlur}
            className="mt-1 w-20 rounded-sm border border-rule bg-paper px-3 py-1.5 text-center text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
          />
          {/* The actually-submitted value — always a valid, already-
              committed 0-20 integer (see commitKameezQuantity), independent
              of whatever the visible field above happens to be showing
              mid-edit. 0 means "no Kameez/Shalwar on this order at all". */}
          <input type="hidden" name="kameezQuantity" value={state.kameezQuantity} />
        </div>

        {state.kameezQuantity > 0 && (
          <>
            <div className="mt-5">
              <p className="-mt-1 mb-3 text-xs text-graphite/50">{en.orderForm.defaultMeasurementsHint}</p>
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

            {/* Step 50 — once there's more than one suit, this first style
                block is explicitly labeled "Suit 1" (it always was suit 1's
                style — see OrderItem's schema comment — this just makes that
                visible once it matters, i.e. once other suits exist to
                contrast it with). Nothing here changes for the single-suit
                case: no label, same grid, same fields, same names. */}
            {state.kameezQuantity > 1 && (
              <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-ink">
                {en.orderForm.suitLabelTemplate.replace("{n}", "1")}
              </p>
            )}
            <div className={`grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 border-t border-rule pt-4 ${state.kameezQuantity > 1 ? "mt-2" : "mt-5"}`}>
              <TileGroup
                legend={en.orderForm.suitType}
                name="suitType"
                options={SUIT_TYPE_OPTIONS}
                value={state.suitType}
                onChange={(v) => handleSuitTypeChange(v as SuitType | "")}
                allowEmpty
              />
              {/* Step 63 — Collar and Bain are one combined choice: exactly
                  one of the two tile groups can have a selection at a time,
                  enforced by handleCollarChange/handleBainChange each
                  clearing the other's field. Both start unselected (""),
                  same as Pocket/Patti — allowEmpty renders each group's own
                  "Not specified" tile, doubling as the visible "nothing
                  chosen yet" state and letting an admin explicitly clear a
                  choice back to none. */}
              <TileGroup
                legend={en.orderForm.collar}
                name="collarType"
                options={COLLAR_TYPE_OPTIONS}
                value={state.collarType}
                onChange={(v) => handleCollarChange(v as CollarType | "")}
                allowEmpty
              />
              <TileGroup
                legend={en.orderForm.bain}
                name="bainType"
                options={BAIN_TYPE_OPTIONS}
                value={state.bainType}
                onChange={(v) => handleBainChange(v as BainType | "")}
                allowEmpty
              />
              <TileGroup
                legend={en.orderForm.cuff}
                name="cuffType"
                options={CUFF_TYPE_OPTIONS}
                value={state.cuffType}
                onChange={(v) => update("cuffType", v as CuffType | "")}
                allowEmpty
              />
              <TileGroup
                legend={en.orderForm.pocket}
                name="pocketOptionId"
                options={pocketOptions.map((o) => ({ value: o.id, label: o.label, imageSrc: DESIGN_OPTION_IMAGES[o.code] }))}
                value={state.pocketOptionId}
                onChange={(v) => update("pocketOptionId", v)}
                allowEmpty
              />
              <TileGroup
                legend={en.orderForm.ghera}
                name="gheraType"
                options={GHERA_TYPE_OPTIONS}
                value={state.gheraType}
                onChange={(v) => update("gheraType", v as GheraType | "")}
                allowEmpty
              />
              {/* Step 57 — Patti Style, immediately below Ghera Style in this
                  same grid (natural DOM/flow order, no separate section).
                  Order-level only, same as every other field in this grid —
                  no per-suit equivalent below (see DraftShape's own comment).
                  Step 58 — spans both grid columns (sm:col-span-2) so its 3
                  options sit in one row on desktop instead of being squeezed
                  into a half-width cell like every other 2-4-option group. */}
              <div className="sm:col-span-2">
                <TileGroup
                  legend={en.orderForm.pattiStyle}
                  name="pattiOptionId"
                  options={pattiOptions.map((o) => ({ value: o.id, label: o.label, imageSrc: DESIGN_OPTION_IMAGES[o.code] }))}
                  value={state.pattiOptionId}
                  onChange={(v) => update("pattiOptionId", v)}
                  allowEmpty
                />
              </div>
              {/* Pancha Style — immediately after Patti Style, same
                  order-level-only, no-per-suit-equivalent shape. No photos
                  yet (real images to be provided later): DESIGN_OPTION_IMAGES
                  simply has no PANCHA_* entries, so these tiles render with
                  just their label, same as StyleTile already supports for
                  any option with no imageSrc. */}
              <div className="sm:col-span-2">
                <TileGroup
                  legend={en.orderForm.panchaStyle}
                  name="panchaOptionId"
                  options={panchaOptions.map((o) => ({ value: o.id, label: o.label, imageSrc: DESIGN_OPTION_IMAGES[o.code] }))}
                  value={state.panchaOptionId}
                  onChange={(v) => update("panchaOptionId", v)}
                  allowEmpty
                />
              </div>
            </div>

            {/* Step 50 (requirements #5/#6/#8) — suit 2 and beyond each get
                their own independent style selection here. Measurements are
                NOT repeated per suit by default (design brief correction):
                the shared default block above already applies to every
                suit; only STYLE differs per suit now. Each block starts as a
                copy of suit 1's style at the moment it was added
                (commitKameezQuantity) and is freely editable from then on. */}
            {state.kameezQuantity > 1 && (
              <div className="mt-6 space-y-6 border-t border-rule pt-5">
                {state.kameezItems.slice(1).map((item, index) => {
                  const position = index + 2;
                  return (
                    <div key={position}>
                      <p className="text-xs font-semibold uppercase tracking-widest text-ink">
                        {en.orderForm.suitLabelTemplate.replace("{n}", String(position))}
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                        <TileGroup
                          legend={en.orderForm.suitType}
                          name={`item.${position}.suitType`}
                          options={SUIT_TYPE_OPTIONS}
                          value={item.style.suitType}
                          onChange={(v) => setItemStyleField(position, "suitType", v as SuitType | "")}
                          allowEmpty
                        />
                        {/* Step 63 — same combined-choice rule as the order-level pair above, applied per-suit. */}
                        <TileGroup
                          legend={en.orderForm.collar}
                          name={`item.${position}.collarType`}
                          options={COLLAR_TYPE_OPTIONS}
                          value={item.style.collarType}
                          onChange={(v) => setItemCollarField(position, v as CollarType | "")}
                          allowEmpty
                        />
                        <TileGroup
                          legend={en.orderForm.bain}
                          name={`item.${position}.bainType`}
                          options={BAIN_TYPE_OPTIONS}
                          value={item.style.bainType}
                          onChange={(v) => setItemBainField(position, v as BainType | "")}
                          allowEmpty
                        />
                        <TileGroup
                          legend={en.orderForm.cuff}
                          name={`item.${position}.cuffType`}
                          options={CUFF_TYPE_OPTIONS}
                          value={item.style.cuffType}
                          onChange={(v) => setItemStyleField(position, "cuffType", v as CuffType | "")}
                          allowEmpty
                        />
                        <TileGroup
                          legend={en.orderForm.pocket}
                          name={`item.${position}.pocketOptionId`}
                          options={pocketOptions.map((o) => ({ value: o.id, label: o.label, imageSrc: DESIGN_OPTION_IMAGES[o.code] }))}
                          value={item.style.pocketOptionId}
                          onChange={(v) => setItemStyleField(position, "pocketOptionId", v)}
                          allowEmpty
                        />
                        <TileGroup
                          legend={en.orderForm.ghera}
                          name={`item.${position}.gheraType`}
                          options={GHERA_TYPE_OPTIONS}
                          value={item.style.gheraType}
                          onChange={(v) => setItemStyleField(position, "gheraType", v as GheraType | "")}
                          allowEmpty
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Per-suit measurement overrides — advanced/optional
                (requirement #8): measurements are shared by default now,
                so this is deliberately the LAST thing in this section,
                still collapsed behind its own checkbox per suit exactly
                as before. Only VISUALLY shown once there's more than one
                suit — with exactly one suit, the shared default
                measurements above already ARE that suit's own
                measurements, so the toggle would be redundant. CSS-hidden
                (never unmounted) rather than conditionally rendered, same
                "stays mounted/controlled/submitted" reasoning as
                coat-measurement-block.tsx's own visibleGroup — a
                previously-set override and its own real values must
                still reach FormData on submit even while this block is
                hidden from view, never silently discarded. */}
            <div className={`mt-6 space-y-3 border-t border-rule pt-5 ${state.kameezQuantity > 1 ? "" : "hidden"}`}>
              <p className="text-xs font-semibold uppercase tracking-widest text-ink">{en.orderForm.perSuitOverridesHeading}</p>
              {state.kameezItems.map((item, index) => {
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
                    {/* The toggle itself is client-only state — the server
                        infers override from whether measurement values were
                        actually entered, but sending it explicitly lets an
                        all-empty, deliberately-blanked override be told
                        apart from "off" if that distinction is ever needed
                        later. */}
                    <input type="hidden" name={`item.${position}.override`} value={item.override ? "on" : "off"} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </SectionCard>
      </div>

      {/* Prince Coat Order — fully independent of Kameez/Shalwar and
          Waistcoat: its own count, its own measurements, its own
          "different measurements" override. Never has any Suit & Styles
          section (Coat entries never had style tiles). Every entry here
          is unconditionally a Prince Coat — see CoatSuitState's own
          comment — so there's no per-entry garment choice any more.
          Always mounted (CSS-hidden, never unmounted) so its real
          quantity/measurements always submit regardless of which tab is
          currently visible. Positions continue the GLOBAL position
          sequence right after Kameez/Shalwar's own (always its real
          kameezQuantity now, since that section is always mounted too —
          no more "unchecked but remembered" indirection needed). */}
      <div className={state.activeOrderTab === "PRINCE_COAT" ? undefined : "hidden"}>
      <SectionCard id="princeCoat" title={en.orderForm.princeCoatOrderSection}>
        <div>
          <label htmlFor="princeCoatQuantity" className="block text-sm font-medium text-graphite">
            {en.orderForm.numberOfPrinceCoats}
          </label>
          <input
            id="princeCoatQuantity"
            type="text"
            inputMode="numeric"
            value={princeCoatQuantityText}
            onChange={(event) => handlePrinceCoatQuantityTextChange(event.target.value)}
            onBlur={handlePrinceCoatQuantityBlur}
            className="mt-1 w-20 rounded-sm border border-rule bg-paper px-3 py-1.5 text-center text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
          />
          <input type="hidden" name="princeCoatQuantity" value={state.princeCoatQuantity} />
        </div>

        {state.princeCoatQuantity > 0 && (
          <>
            <div className="mt-5">
              <CoatMeasurementBlock
                blockId="default-prince-coat"
                namePrefix="default"
                values={state.coatDefaultValues}
                onChange={setCoatDefaultValue}
                originalValues={coatMeasurementBlockValuesFrom(coatMeasurement)}
                activeField={defaultCoatActiveField}
                onActiveFieldChange={setDefaultCoatActiveField}
                visibleGroup="PRINCE_COAT"
              />
            </div>

            {/* Prince Coat's price comes exclusively from Settings' own
                configured default — no admin-facing input anywhere (see
                DraftShape's own comment on state.princeCoatUnitPrice).
                This hidden field is the one real submitted value. */}
            <input type="hidden" name="princeCoatUnitPrice" value={state.princeCoatUnitPrice} />

            {/* Only VISUALLY shown once there's more than one Prince
                Coat — see the Kameez/Shalwar override block's own
                comment above for why CSS-hide, never a JS conditional
                unmount: this item's own measurementMode/
                coatGarmentSelection hidden fields below are structural
                facts the server actually reads and must always submit,
                regardless of whether the override UI is visible. */}
            <div className={`mt-6 space-y-3 border-t border-rule pt-5 ${state.princeCoatQuantity > 1 ? "" : "hidden"}`}>
              <p className="text-xs font-semibold uppercase tracking-widest text-ink">{en.orderForm.perPrinceCoatOverridesHeading}</p>
              {state.princeCoatItems.map((item, index) => {
                const position = state.kameezQuantity + index + 1;
                return (
                  <div key={position} className="rounded-sm border border-rule/70 bg-paper p-3">
                    <label className="flex items-center gap-2.5 text-sm font-medium text-graphite">
                      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo/10 text-xs font-semibold tabular-nums text-indigo">
                        {index + 1}
                      </span>
                      <input
                        type="checkbox"
                        checked={item.override}
                        onChange={(event) => togglePrinceCoatOverride(index + 1, event.target.checked)}
                        className="h-4 w-4 rounded-sm border-rule text-indigo focus:ring-indigo"
                      />
                      {en.orderForm.princeCoatLabelTemplate.replace("{n}", String(index + 1))} — {en.orderForm.overrideToggle}
                    </label>
                    {item.override && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs text-graphite/50">{en.orderForm.overrideHint}</p>
                        <CoatMeasurementBlock
                          blockId={`item-prince-coat-${position}`}
                          namePrefix={`item.${position}`}
                          values={item.values}
                          onChange={(key, value) => setPrinceCoatItemFieldValue(index + 1, key, value)}
                          activeField={princeCoatItemActiveFields[index] ?? ""}
                          onActiveFieldChange={(key) =>
                            setPrinceCoatItemActiveFields((prev) => {
                              const next = [...prev];
                              next[index] = key;
                              return next;
                            })
                          }
                          visibleGroup="PRINCE_COAT"
                        />
                      </div>
                    )}
                    <input type="hidden" name={`item.${position}.override`} value={item.override ? "on" : "off"} />
                    {/* Both facts below are plain structural facts — never
                        admin-facing choices. Which garment this position
                        is for comes from which tab's list it's in (this
                        one, Prince Coat — see this SectionCard's own top
                        comment), not a per-entry dropdown any more. */}
                    <input type="hidden" name={`item.${position}.measurementMode`} value="COAT" />
                    <input type="hidden" name={`item.${position}.coatGarmentSelection`} value="PRINCE_COAT" />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </SectionCard>
      </div>

      {/* Waistcoat Order — sibling of Prince Coat above, same shape.
          Positions continue right after Kameez/Shalwar's AND Prince
          Coat's own (both always fully submitted now, regardless of
          which tab is visible). */}
      <div className={state.activeOrderTab === "WAISTCOAT" ? undefined : "hidden"}>
      <SectionCard id="waistcoat" title={en.orderForm.waistcoatOrderSection}>
        <div>
          <label htmlFor="waistcoatQuantity" className="block text-sm font-medium text-graphite">
            {en.orderForm.numberOfWaistcoats}
          </label>
          <input
            id="waistcoatQuantity"
            type="text"
            inputMode="numeric"
            value={waistcoatQuantityText}
            onChange={(event) => handleWaistcoatQuantityTextChange(event.target.value)}
            onBlur={handleWaistcoatQuantityBlur}
            className="mt-1 w-20 rounded-sm border border-rule bg-paper px-3 py-1.5 text-center text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
          />
          <input type="hidden" name="waistcoatQuantity" value={state.waistcoatQuantity} />
        </div>

        {state.waistcoatQuantity > 0 && (
          <>
            <div className="mt-5">
              <CoatMeasurementBlock
                blockId="default-waistcoat"
                namePrefix="default"
                values={state.coatDefaultValues}
                onChange={setCoatDefaultValue}
                originalValues={coatMeasurementBlockValuesFrom(coatMeasurement)}
                activeField={defaultCoatActiveField}
                onActiveFieldChange={setDefaultCoatActiveField}
                visibleGroup="WAISTCOAT"
              />
            </div>

            {/* Waistcoat's price comes exclusively from Settings' own
                configured default — sibling of Prince Coat's own above. */}
            <input type="hidden" name="waistcoatUnitPrice" value={state.waistcoatUnitPrice} />

            {/* Only VISUALLY shown once there's more than one Waistcoat —
                CSS-hidden, never JS-unmounted, same reasoning as Prince
                Coat's own block above (its structural hidden fields
                below must always submit). */}
            <div className={`mt-6 space-y-3 border-t border-rule pt-5 ${state.waistcoatQuantity > 1 ? "" : "hidden"}`}>
              <p className="text-xs font-semibold uppercase tracking-widest text-ink">{en.orderForm.perWaistcoatOverridesHeading}</p>
              {state.waistcoatItems.map((item, index) => {
                const position = state.kameezQuantity + state.princeCoatQuantity + index + 1;
                return (
                  <div key={position} className="rounded-sm border border-rule/70 bg-paper p-3">
                    <label className="flex items-center gap-2.5 text-sm font-medium text-graphite">
                      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo/10 text-xs font-semibold tabular-nums text-indigo">
                        {index + 1}
                      </span>
                      <input
                        type="checkbox"
                        checked={item.override}
                        onChange={(event) => toggleWaistcoatOverride(index + 1, event.target.checked)}
                        className="h-4 w-4 rounded-sm border-rule text-indigo focus:ring-indigo"
                      />
                      {en.orderForm.waistcoatLabelTemplate.replace("{n}", String(index + 1))} — {en.orderForm.overrideToggle}
                    </label>
                    {item.override && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs text-graphite/50">{en.orderForm.overrideHint}</p>
                        <CoatMeasurementBlock
                          blockId={`item-waistcoat-${position}`}
                          namePrefix={`item.${position}`}
                          values={item.values}
                          onChange={(key, value) => setWaistcoatItemFieldValue(index + 1, key, value)}
                          activeField={waistcoatItemActiveFields[index] ?? ""}
                          onActiveFieldChange={(key) =>
                            setWaistcoatItemActiveFields((prev) => {
                              const next = [...prev];
                              next[index] = key;
                              return next;
                            })
                          }
                          visibleGroup="WAISTCOAT"
                        />
                      </div>
                    )}
                    <input type="hidden" name={`item.${position}.override`} value={item.override ? "on" : "off"} />
                    <input type="hidden" name={`item.${position}.measurementMode`} value="COAT" />
                    <input type="hidden" name={`item.${position}.coatGarmentSelection`} value="WAISTCOAT" />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </SectionCard>
      </div>

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
              readOnly={isEdit}
              value={state.orderDate}
              onChange={(event) => {
                if (!isEdit) handleOrderDateChange(event.target.value);
              }}
              className={`mt-1 block w-full rounded-sm border border-rule px-3 py-2 text-graphite focus:outline-none focus:ring-1 focus:ring-indigo ${
                isEdit ? "cursor-not-allowed bg-paper/60 text-graphite/50" : "bg-paper focus:border-indigo"
              }`}
            />
            {/* Step 53 — Order Date is never editable once an order
                exists (see OrderEditData's own comment); this reassures
                the admin it isn't a bug, not a missing feature. */}
            {isEdit && <p className="mt-0.5 text-xs text-graphite/50">{en.orderForm.orderDateLocked}</p>}
          </div>
        </div>

        {/* Requirement 4 — Kameez/Shalwar, Prince Coat, and Waistcoat
            totals shown independently, purely informational (feeding the
            one real editable/submitted Total below exactly the way the
            existing suggestion hint already did) — never a separate
            persisted figure; see computeKameezTotal/computeCoatTotal's
            own comments. Each line only shows once that section
            genuinely has something to total. */}
        {(orderedKameezSuitTypes.length > 0 || princeCoatQuantity > 0 || waistcoatQuantity > 0) && (
          <div className="mt-4 space-y-1 rounded-sm border border-rule bg-paper p-3 text-sm">
            {orderedKameezSuitTypes.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-graphite/60">{en.orderForm.kameezShalwarTotal}</span>
                <span className="tabular-nums text-graphite">{kameezTotal !== null ? `Rs. ${kameezTotal}` : "—"}</span>
              </div>
            )}
            {/* Independent Prince Coat/Waistcoat pricing — each line only
                shows when that SPECIFIC garment's own quantity > 0; the
                two are never shown/hidden together any more since each
                is its own fully independent tab/section now. */}
            {princeCoatQuantity > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-graphite/60">
                  {en.orderForm.princeCoatTotal} ({princeCoatQuantity} × Rs. {state.princeCoatUnitPrice || "—"})
                </span>
                <span className="tabular-nums text-graphite">{princeCoatTotal !== null ? `Rs. ${princeCoatTotal}` : "—"}</span>
              </div>
            )}
            {waistcoatQuantity > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-graphite/60">
                  {en.orderForm.waistcoatTotal} ({waistcoatQuantity} × Rs. {state.waistcoatUnitPrice || "—"})
                </span>
                <span className="tabular-nums text-graphite">{waistcoatTotal !== null ? `Rs. ${waistcoatTotal}` : "—"}</span>
              </div>
            )}
          </div>
        )}

        {/* Prince Coat/Waistcoat prices come exclusively from Settings'
            own configured defaults now — no per-order override input
            anywhere (removed per explicit instruction). state.
            princeCoatUnitPrice/waistcoatUnitPrice still exist (see
            DraftShape's own comment) purely to carry either that
            Settings default (a new order) or this order's own already-
            frozen historical price (editing an existing one) through to
            the two hidden fields inside each garment's own section below
            — never admin-edited here. */}

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
            {/* Step 64 — the hint now compares against the correctly
                summed combined default (Kameez/Shalwar's own sum plus
                Coat/Waistcoat's own, independently — never one price ×
                Number of Suits), so it still only shows while Total
                genuinely still matches that computed sum. */}
            {!state.totalTouched && state.totalAmount === combinedSuggestedTotal && (
              <p className="mt-0.5 text-xs text-graphite/50">{en.orderForm.totalSuggested}</p>
            )}
            {/* Follow-up fix — once the admin types into Total directly,
                totalTouched locks in that value for the rest of the
                session (by design — never silently snap back). This is
                the explicit, opt-in way back to the live-calculated
                figure, rather than having to clear and retype it. Only
                shown when there's an actual computed figure to offer,
                and only in Edit mode — Create Order already recalculates
                live by default, so this UI stays unchanged there
                (requirement: "Keep Create Order behavior unchanged"). */}
            {isEdit && combinedSuggestedTotal !== null && (
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, totalAmount: combinedSuggestedTotal, totalTouched: false }))}
                className="mt-1 text-xs font-medium text-indigo underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1"
              >
                {en.orderForm.recalculateFromItems}
              </button>
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
              value={state.advanceAmount}
              onChange={(event) => handleAdvanceAmountChange(event.target.value)}
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2.5 text-right text-lg font-semibold tabular-nums text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
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
          Server Action's own formData.get() call.
          Step 53 — hidden entirely in mode="edit": editing an order
          isn't "save and print/send" the way creating one is, and every
          existing customer-facing action (Receipt/Work Order/WhatsApp)
          stays reachable from the order detail page this always returns
          to. */}
      {!isEdit && (
        <>
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
        </>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-sm bg-indigo px-4 py-3.5 text-base font-medium text-white shadow-sm transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2 disabled:opacity-60"
      >
        {submitting ? en.orderForm.saving : isEdit ? en.orderForm.saveChanges : en.orderForm.save}
      </button>
    </form>
  );
}

/**
 * One of the three Order Type Selection tabs. Reuses the same
 * selected/unselected color language as StyleTile (indigo border + tint
 * when active, graphite/rule otherwise) for visual consistency with the
 * rest of this form's tile-based choices. Width-only change from the
 * original: `w-full` so each one exactly fills its grid-cols-3 cell
 * (100% of the row, 1/3 each) instead of shrinking to its label's own
 * width — height/padding/font/layout are otherwise byte-for-byte the
 * original compact row (label left, quantity badge right), no corner
 * checkmark. The small badge shows this type's own current quantity
 * whenever it's > 0, regardless of whether this tab is the one currently
 * visible — so "added to this order" stays visible even while looking
 * at a different tab.
 */
function OrderTypeTabButton({
  label,
  selected,
  quantity,
  onSelect,
}: {
  label: string;
  selected: boolean;
  quantity: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between gap-2 rounded-sm border-2 px-4 py-3 text-left transition ${
        selected ? "border-indigo bg-indigo/5 shadow-sm" : "border-rule bg-card hover:border-graphite/40 hover:bg-paper"
      }`}
    >
      <span className={`text-sm font-medium ${selected ? "text-ink" : "text-graphite/70"}`}>{label}</span>
      {quantity > 0 && (
        <span
          className={`flex h-5 min-w-[1.25rem] flex-none items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${
            selected ? "bg-indigo text-white" : "bg-graphite/15 text-graphite"
          }`}
        >
          {quantity}
        </span>
      )}
    </button>
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
  options: readonly { value: T; label: string; imageSrc?: string }[];
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
          <StyleTile
            key={option.value}
            label={option.label}
            selected={value === option.value}
            onSelect={() => onChange(option.value)}
            imageSrc={option.imageSrc}
          />
        ))}
      </div>
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}
