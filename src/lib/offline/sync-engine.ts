// Phase 4 — the offline sync queue + processor.
// Phase 5 — extended with CREATE_CUSTOMER/UPDATE_CUSTOMER. Same queue,
// same processor, same syncQueue table (Phase 2) — no second queue
// implementation, per the Phase 5 task's own explicit instruction.
//
// Plain module, not a component (matches ./db.ts's own pattern — no
// "use client" on a non-component file). Imports nothing server-only.
//
// Dependency ordering note (Phase 5): a customer created offline and
// then edited later in the same offline session naturally produces one
// CREATE_CUSTOMER queue item followed by one UPDATE_CUSTOMER item for
// the same id. No generic dependency-graph logic was added for this —
// the processor's existing strict FIFO-by-createdAt drain (unchanged
// from Phase 4) already guarantees the CREATE item is always attempted
// (and, given connectivity, synced) before the later UPDATE item is ever
// picked up, since a `pending` CREATE item always has an earlier
// `createdAt` and is therefore always selected first. If the CREATE
// permanently fails (rejected), the follow-up UPDATE will itself fail
// with "not-found" against the server — visible and preserved (see
// processSyncQueue below), never silently lost or corrupted.
import { getOfflineDb, isOfflineDbAvailable, describeOfflineStorageError } from "./db";
import { runInitialSync } from "./initial-sync";
import type {
  SyncQueueItem,
  SyncOp,
  LocalCustomer,
  LocalMeasurement,
  LocalCoatMeasurement,
  LocalOrder,
  LocalOrderItem,
  SuitType,
  CollarType,
  BainType,
  CuffType,
  GheraType,
  MeasurementMode,
  CoatGarmentSelection,
} from "./types";
// customer-validation.ts is a plain module (no "use server", no Prisma
// import — confirmed in the approved Phase 1 architecture's own
// classification) — safe to import client-side. Reused here for local,
// fast-feedback validation using the EXACT SAME Zod schema the server
// re-validates with (customer-sync.ts), not a second copy of the rule.
import { customerInputSchema } from "@/lib/customer-validation";
// Phase 6 — measurement-value.ts and money.ts are both plain, client-
// safe modules (no "use server", no Prisma import) per the approved
// Phase 1 validation-boundary classification. Reused here the same way
// customerInputSchema is above — not a second copy of either rule.
import { measurementInputSchema, shalwarPocketToBoolean } from "@/lib/measurement-value";
import { coatMeasurementInputSchema } from "@/lib/coat-measurement-value";
import { ALL_COAT_FIELD_KEYS } from "@/lib/coat-measurement-fields";
import { MONEY_REGEX, calculateBalance, isAdvanceWithinTotal } from "@/lib/money";

// The four statuses an order can actually be moved to from the UI —
// same set order-status-form.tsx's own OPTIONS array already uses;
// PENDING is legacy and was never a selectable target. This is local,
// fast-feedback validation ONLY (Phase 4 §17/§18) — the server
// (order-status-update.ts's applyOrderStatusUpdate, called from both the
// existing Server Action and the new Route Handler below) remains the
// authoritative check regardless of what happens here.
type SelectableOrderStatus = "NEW" | "STITCHING" | "READY" | "DELIVERED";
const VALID_ORDER_STATUS_VALUES: readonly SelectableOrderStatus[] = ["NEW", "STITCHING", "READY", "DELIVERED"];

export function isValidSelectableOrderStatus(value: unknown): value is SelectableOrderStatus {
  return VALID_ORDER_STATUS_VALUES.includes(value as SelectableOrderStatus);
}

/** What a caller actually supplies — unchanged from before this upgrade, so OrderStatusForm/the dev diagnostic page need no changes. */
export interface OrderStatusUpdateInput {
  customerId: string;
  orderId: string;
  status: SelectableOrderStatus;
}

export interface UpdateOrderStatusPayload {
  customerId: string;
  orderId: string;
  status: SelectableOrderStatus;
  /** The local order's own confirmed baseline at enqueue time — frozen for real at first dispatch (prepareItemForDispatch), same rule as UPDATE_CUSTOMER/UPDATE_ORDER. */
  baseUpdatedAt: string;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Defensive fallback only — every evergreen browser has
  // crypto.randomUUID(); this branch should never actually execute.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface EnqueueResult {
  queued: boolean;
  reason?: "invalid-status" | "no-indexeddb" | "storage-error" | "unknown-baseline";
  message?: string;
}

/**
 * Local-first write for an order status change (Phase 4 §3/§9): updates
 * the local order row and inserts a syncQueue item, in ONE Dexie
 * transaction. If the browser crashes between "the order looks changed
 * locally" and "a queue item exists to actually deliver that change",
 * this transaction guarantees that state is never reached — both writes
 * commit together, or neither does.
 *
 * Follow-up fix — this used to proceed even when the local mirror had no
 * row for this order at all (the old comment here called that "harmless"
 * on the theory that nothing read the local row for display). That
 * theory was wrong: prepareItemForDispatch()'s own baseline re-resolution
 * (readLiveBaseline) depends on this row existing with a real
 * baseUpdatedAt, and fails CLOSED, permanently, with no retry, if it
 * doesn't — exactly the "Could not establish a safe version baseline"
 * dispatchBlocked state. The one confirmed way to reach that state: an
 * order created together with a brand-new customer (order-form.tsx's
 * `createCustomerAndOrder` Server Action, mode="new") is a plain online
 * write with no corresponding enqueueCreateOrder() call at all, so the
 * local `orders` table never gets a row for it until the next full page
 * load's initial sync pull. Rather than relax the dispatch-time safety
 * check (which would risk a real stale overwrite), this stops the
 * doomed item from ever being queued in the first place — failing
 * immediately, visibly, and recoverably instead of permanently and
 * silently much later.
 */
export async function enqueueOrderStatusUpdate(input: OrderStatusUpdateInput): Promise<EnqueueResult> {
  if (!isValidSelectableOrderStatus(input.status)) {
    return { queued: false, reason: "invalid-status" };
  }
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const db = getOfflineDb();

  const existingOrder = await db.orders.get(input.orderId);
  const baseUpdatedAt = existingOrder?.baseUpdatedAt;
  if (!baseUpdatedAt) {
    return {
      queued: false,
      reason: "unknown-baseline",
      message: "This order hasn't finished loading on this device yet. Please refresh the page and try again.",
    };
  }

  const idempotencyKey = generateIdempotencyKey();

  try {
    await db.transaction("rw", [db.orders, db.syncQueue], async () => {
      await db.orders.update(input.orderId, { status: input.status, syncStatus: "pending" });

      const payload: UpdateOrderStatusPayload = { customerId: input.customerId, orderId: input.orderId, status: input.status, baseUpdatedAt };
      const item: SyncQueueItem = {
        op: "UPDATE_ORDER_STATUS",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
        baselineResolved: false,
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true };
}

// ── Customer create/edit (Phase 5) ──────────────────────────────────────

export interface CreateCustomerPayload {
  id: string;
  name: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  address: string | null;
}

export interface UpdateCustomerPayload {
  customerId: string;
  name: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  address: string | null;
  /** The local customer's own `updatedAt` at the moment this edit was made — the server's conflict guard compares against this (Phase 5 §H). */
  baseUpdatedAt: string;
}

export interface CustomerEnqueueResult {
  queued: boolean;
  id?: string;
  reason?: "invalid-input" | "no-indexeddb" | "storage-error";
  message?: string;
}

/**
 * Local-first customer creation (Phase 5 §A/§D/§E). Generates the
 * permanent client-side id (crypto.randomUUID()) once, here — never
 * regenerated on retry, never remapped after sync. `customerCode` is
 * always null locally; only the server ever assigns one (see
 * customer-sync.ts's applyCustomerCreateSync). Local write + queue
 * insertion happen in ONE Dexie transaction, exactly like
 * enqueueOrderStatusUpdate above.
 */
export async function enqueueCreateCustomer(input: {
  name: string;
  phonePrimary: string;
  phoneSecondary: string;
  address: string;
}): Promise<CustomerEnqueueResult> {
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const parsed = customerInputSchema.safeParse({
    name: input.name,
    phonePrimary: input.phonePrimary,
    phoneSecondary: input.phoneSecondary || undefined,
    address: input.address || undefined,
  });
  if (!parsed.success) {
    return { queued: false, reason: "invalid-input", message: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const db = getOfflineDb();
  const id = crypto.randomUUID();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();

  try {
    await db.transaction("rw", [db.customers, db.syncQueue], async () => {
      const row: LocalCustomer = {
        id,
        customerCode: null, // never guessed locally — server-assigned only (Phase 5 §E)
        name: parsed.data.name,
        phonePrimary: parsed.data.phonePrimary,
        phoneSecondary: parsed.data.phoneSecondary ?? null,
        address: parsed.data.address ?? null,
        deletedAt: null,
        createdById: null, // stamped server-side from the session at sync time
        createdAt: now,
        updatedAt: now,
        baseUpdatedAt: null, // nothing confirmed by the server yet — this device's own CREATE_CUSTOMER sync could set it, but that endpoint doesn't currently return updatedAt (out of scope here)
        syncStatus: "pending",
      };
      await db.customers.add(row);

      const payload: CreateCustomerPayload = {
        id,
        name: row.name,
        phonePrimary: row.phonePrimary,
        phoneSecondary: row.phoneSecondary,
        address: row.address,
      };
      const item: SyncQueueItem = {
        op: "CREATE_CUSTOMER",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true, id };
}

/**
 * Local-first customer edit (Phase 5 §C). `customerId` is the same
 * permanent id regardless of whether the customer has finished its own
 * create-sync yet (see the file header's FIFO note). Captures the local
 * row's current `updatedAt` as `baseUpdatedAt` before overwriting it —
 * this is the value the server's conflict guard checks against.
 */
export async function enqueueUpdateCustomer(
  customerId: string,
  input: { name: string; phonePrimary: string; phoneSecondary: string; address: string }
): Promise<CustomerEnqueueResult> {
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const parsed = customerInputSchema.safeParse({
    name: input.name,
    phonePrimary: input.phonePrimary,
    phoneSecondary: input.phoneSecondary || undefined,
    address: input.address || undefined,
  });
  if (!parsed.success) {
    return { queued: false, reason: "invalid-input", message: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const db = getOfflineDb();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();

  try {
    await db.transaction("rw", [db.customers, db.syncQueue], async () => {
      const existing = await db.customers.get(customerId);
      // Placeholder only — prepareItemForDispatch() re-resolves this from
      // the live local record at first dispatch and freezes it there, so
      // this enqueue-time value is never actually sent. Still computed
      // defensively (preferring the confirmed baseUpdatedAt over the
      // mutable updatedAt) in case dispatch ever needs a last-resort value.
      const baseUpdatedAt = existing?.baseUpdatedAt ?? existing?.updatedAt ?? now;

      const name = parsed.data.name;
      const phonePrimary = parsed.data.phonePrimary;
      const phoneSecondary = parsed.data.phoneSecondary ?? null;
      const address = parsed.data.address ?? null;

      await db.customers.update(customerId, {
        name,
        phonePrimary,
        phoneSecondary,
        address,
        updatedAt: now,
        syncStatus: "pending",
      });

      const payload: UpdateCustomerPayload = { customerId, name, phonePrimary, phoneSecondary, address, baseUpdatedAt };
      const item: SyncQueueItem = {
        op: "UPDATE_CUSTOMER",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
        baselineResolved: false,
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true, id: customerId };
}

// ── Measurement save (Phase 6) ──────────────────────────────────────────

export interface SaveMeasurementPayload {
  customerId: string;
  length: string;
  shoulder: string;
  sleeve: string;
  armHole: string;
  kohni: string;
  neck: string;
  chest: string;
  waist: string;
  hem: string;
  shalwarLength: string;
  pancha: string;
  shalwarGheraReady: string;
  shalwarPocket: string;
  note: string;
}

/**
 * Local-first measurement save (Phase 6 §A). Unlike Customer/Order,
 * a Measurement has no separate identity question to resolve locally —
 * it's strictly 1:1 with its customer (Measurement.customerId is
 * @unique server-side), so the local row's own `id` only needs to be
 * SOME stable Dexie primary key: an existing local row's id is reused
 * if one is already present (from Phase 3's initial sync or a prior
 * offline save), otherwise `customerId` itself is used — never a
 * separate generated id nobody needs to track, since nothing anywhere
 * looks up a measurement by its own id (only ever via customerId).
 * Local write + queue insertion happen in ONE Dexie transaction, same
 * as every other enqueue function in this file.
 */
export async function enqueueSaveMeasurement(
  customerId: string,
  input: {
    length: string;
    shoulder: string;
    sleeve: string;
    armHole: string;
    kohni: string;
    neck: string;
    chest: string;
    waist: string;
    hem: string;
    shalwarLength: string;
    pancha: string;
    shalwarGheraReady: string;
    shalwarPocket: string;
    note: string;
  }
): Promise<CustomerEnqueueResult> {
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const parsed = measurementInputSchema.safeParse({
    length: input.length || undefined,
    shoulder: input.shoulder || undefined,
    sleeve: input.sleeve || undefined,
    armHole: input.armHole || undefined,
    kohni: input.kohni || undefined,
    neck: input.neck || undefined,
    chest: input.chest || undefined,
    waist: input.waist || undefined,
    hem: input.hem || undefined,
    shalwarLength: input.shalwarLength || undefined,
    pancha: input.pancha || undefined,
    shalwarGheraReady: input.shalwarGheraReady || undefined,
    shalwarPocket: input.shalwarPocket || "",
    note: input.note || undefined,
  });
  if (!parsed.success) {
    return { queued: false, reason: "invalid-input", message: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const db = getOfflineDb();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();
  const data = parsed.data;
  const shalwarPocket = shalwarPocketToBoolean(data.shalwarPocket);

  try {
    await db.transaction("rw", [db.measurements, db.syncQueue], async () => {
      const existing = await db.measurements.where("customerId").equals(customerId).first();
      const row: LocalMeasurement = {
        id: existing?.id ?? customerId,
        customerId,
        length: data.length ?? null,
        shoulder: data.shoulder ?? null,
        sleeve: data.sleeve ?? null,
        armHole: data.armHole ?? null,
        kohni: data.kohni ?? null,
        neck: data.neck ?? null,
        chest: data.chest ?? null,
        waist: data.waist ?? null,
        hem: data.hem ?? null,
        shalwarLength: data.shalwarLength ?? null,
        pancha: data.pancha ?? null,
        shalwarPocket,
        shalwarGheraReady: data.shalwarGheraReady ?? null,
        note: data.note ?? null,
        updatedById: null, // stamped server-side from the session at sync time
        updatedAt: now,
        syncStatus: "pending",
      };
      await db.measurements.put(row);

      const payload: SaveMeasurementPayload = {
        customerId,
        length: data.length ?? "",
        shoulder: data.shoulder ?? "",
        sleeve: data.sleeve ?? "",
        armHole: data.armHole ?? "",
        kohni: data.kohni ?? "",
        neck: data.neck ?? "",
        chest: data.chest ?? "",
        waist: data.waist ?? "",
        hem: data.hem ?? "",
        shalwarLength: data.shalwarLength ?? "",
        pancha: data.pancha ?? "",
        shalwarGheraReady: data.shalwarGheraReady ?? "",
        shalwarPocket: data.shalwarPocket,
        note: data.note ?? "",
      };
      const item: SyncQueueItem = {
        op: "SAVE_MEASUREMENT",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true, id: customerId };
}

// ── Coat measurement save ───────────────────────────────────────────────

export interface SaveCoatMeasurementPayload {
  customerId: string;
  [key: string]: string;
}

/** Coat-mode sibling of enqueueSaveMeasurement above — same local-first shape, same reasoning, mirrored field-by-field via ALL_COAT_FIELD_KEYS instead of hand-listing each one. */
export async function enqueueSaveCoatMeasurement(
  customerId: string,
  input: Record<string, string> & { note: string }
): Promise<CustomerEnqueueResult> {
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const raw: Record<string, string | undefined> = {};
  for (const key of ALL_COAT_FIELD_KEYS) {
    raw[key] = input[key] || undefined;
  }
  const parsed = coatMeasurementInputSchema.safeParse({ ...raw, note: input.note || undefined });
  if (!parsed.success) {
    return { queued: false, reason: "invalid-input", message: parsed.error.issues.map((i) => i.message).join(" ") };
  }

  const db = getOfflineDb();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();
  const data = parsed.data as Record<string, string | undefined>;

  try {
    await db.transaction("rw", [db.coatMeasurements, db.syncQueue], async () => {
      const existing = await db.coatMeasurements.where("customerId").equals(customerId).first();
      const row: LocalCoatMeasurement = {
        id: existing?.id ?? customerId,
        customerId,
        note: data.note ?? null,
        updatedById: null,
        updatedAt: now,
        syncStatus: "pending",
      } as LocalCoatMeasurement;
      for (const key of ALL_COAT_FIELD_KEYS) {
        (row as unknown as Record<string, string | null>)[key] = data[key] ?? null;
      }
      await db.coatMeasurements.put(row);

      const payload: SaveCoatMeasurementPayload = { customerId, note: data.note ?? "" };
      for (const key of ALL_COAT_FIELD_KEYS) {
        payload[key] = data[key] ?? "";
      }
      const item: SyncQueueItem = {
        op: "SAVE_COAT_MEASUREMENT",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true, id: customerId };
}

// ── Order creation (Phase 6) ────────────────────────────────────────────

export interface CreateOrderPayload {
  id: string;
  customerId: string;
  /** Raw string fields exactly as read from the order form's FormData — reconstructed into a real FormData at send time so validateOrderInput() (order-actions.ts) can be reused completely unchanged server-side. */
  fields: Record<string, string>;
}

export interface OrderEnqueueResult {
  queued: boolean;
  id?: string;
  reason?: "invalid-input" | "no-indexeddb" | "storage-error";
  message?: string;
}

/**
 * Local-first order creation for an existing, locally-known customer
 * (Phase 6 §B). `formData` is exactly what the order form's own
 * `new FormData(formElement)` produces — the same field names
 * validateOrderInput() already reads (orderDate, suitType, totalAmount,
 * "default.*", "item.N.*", etc.), so no separate field-by-field
 * duplication of that shape is needed here.
 *
 * Only light, fast-feedback local checks are done (required fields
 * present, money fields well-formed) — full validation (per-suit
 * measurement decimals, DesignOption existence, quantity bounds) stays
 * server-only, exactly like the approved Phase 1 validation-boundary
 * table calls for; see the Phase 6 report for why this isn't
 * duplicated here.
 *
 * Generates the permanent client-side order id (crypto.randomUUID())
 * once, here — never regenerated on retry. `orderNumber` is always null
 * locally, exactly like `customerCode` (Phase 5) — only the server ever
 * assigns one. Local write + queue insertion happen in ONE Dexie
 * transaction, same as every other enqueue function in this file.
 */
export async function enqueueCreateOrder(customerId: string, formData: FormData): Promise<OrderEnqueueResult> {
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const fields: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") fields[key] = value;
  });

  // Step 63 — Collar/Bain removed from the blanket REQUIRED list: they're
  // now a combined choice (exactly one, not both) rather than two
  // independently-required fields — checked separately just below.
  // Upgrade — suitType/cuffType/gheraType removed too: each can now be
  // deliberately "Not Specified", and a Coat/Waistcoat-only order
  // (kameezQuantity 0) submits none of them at all (see order-actions.ts's
  // own comment on the same kameezQuantity-conditional rule server-side)
  // — this local fast-feedback check must never be stricter than the
  // server it's only a preview of.
  const REQUIRED = ["orderDate", "totalAmount", "advanceAmount"];
  for (const key of REQUIRED) {
    if (!fields[key] || fields[key].trim() === "") {
      return { queued: false, reason: "invalid-input", message: `${key} is required` };
    }
  }
  // Independent sections upgrade — Order.measurementMode is never
  // actually submitted by the current form any more (it always defaults
  // to KAMEEZ_SHALWAR server-side); the real per-position type is
  // entirely determined by kameezQuantity vs. coatQuantity.
  const kameezQuantity = Math.max(0, Math.min(20, parseInt(fields.kameezQuantity, 10) || 0));
  if (kameezQuantity > 0 && (fields.collarType ? 1 : 0) + (fields.bainType ? 1 : 0) !== 1) {
    return { queued: false, reason: "invalid-input", message: "Select either a Collar or a Bain (not both, and not neither)" };
  }
  if (!MONEY_REGEX.test(fields.totalAmount) || !MONEY_REGEX.test(fields.advanceAmount)) {
    return { queued: false, reason: "invalid-input", message: "Total and Advance Amount must be valid non-negative numbers" };
  }
  if (!isAdvanceWithinTotal(fields.totalAmount, fields.advanceAmount)) {
    return { queued: false, reason: "invalid-input", message: "Advance Amount cannot exceed Total Amount" };
  }

  const db = getOfflineDb();
  const id = crypto.randomUUID();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();
  const balanceAmount = calculateBalance(fields.totalAmount, fields.advanceAmount);

  try {
    await db.transaction("rw", [db.orders, db.syncQueue], async () => {
      const row: LocalOrder = {
        id,
        orderNumber: null, // never guessed locally — server-assigned only (Phase 6 §B)
        customerId,
        orderDate: new Date(fields.orderDate).toISOString(),
        deliveryDate: fields.deliveryDate ? new Date(fields.deliveryDate).toISOString() : null,
        measurementMode: "KAMEEZ_SHALWAR",
        suitType: (fields.suitType || null) as SuitType | null,
        collarType: (fields.collarType || null) as CollarType | null,
        bainType: (fields.bainType || null) as BainType | null,
        cuffType: (fields.cuffType || null) as CuffType | null,
        gheraType: (fields.gheraType || null) as GheraType | null,
        pocketOptionId: fields.pocketOptionId || null,
        pattiOptionId: fields.pattiOptionId || null,
        panchaOptionId: fields.panchaOptionId || null,
        defaultMeasurementSnapshotId: null,
        totalAmount: fields.totalAmount,
        advanceAmount: fields.advanceAmount,
        balanceAmount,
        princeCoatUnitPrice: fields.princeCoatUnitPrice || null,
        waistcoatUnitPrice: fields.waistcoatUnitPrice || null,
        status: "NEW",
        createdById: null, // stamped server-side from the session at sync time
        note: fields.note || null,
        createdAt: now,
        updatedAt: now,
        baseUpdatedAt: null, // nothing confirmed by the server yet — this device's own CREATE_ORDER sync sets it (see the success-handler branch below)
        syncStatus: "pending",
      };
      await db.orders.add(row);

      const payload: CreateOrderPayload = { id, customerId, fields };
      const item: SyncQueueItem = {
        op: "CREATE_ORDER",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true, id };
}

// ── Order edit (Step 53) ────────────────────────────────────────────────

export interface UpdateOrderPayload {
  orderId: string;
  customerId: string;
  /** Same raw-FormData-fields shape as CreateOrderPayload — reconstructed into a real FormData at send time so applyOrderUpdateSync -> validateOrderInput() can be reused completely unchanged server-side. */
  fields: Record<string, string>;
  /** The local order's own `updatedAt` at the moment this edit was made — the server's conflict guard compares against this (same Phase 5 §H pattern UpdateCustomerPayload already uses). */
  baseUpdatedAt: string;
}

/**
 * Local-first order edit (Step 53). `formData` is exactly what
 * OrderForm's own `new FormData(formElement)` produces in mode="edit" —
 * the same field names validateOrderInput() already reads, so (like
 * enqueueCreateOrder above) no separate field-by-field duplication of
 * that shape is needed here.
 *
 * Only light, fast-feedback local checks are done, same scope as
 * enqueueCreateOrder — full validation stays server-only. Updates the
 * local order row and reconciles the local orderItems to the new
 * quantity (deleting extras, updating survivors, adding new ones) so
 * anything reading this order's local mirror while still unsynced sees
 * the edit — the exact same "local storage is the source of truth while
 * pending" principle every other local-first form in this app already
 * follows. Local write + queue insertion happen in ONE Dexie
 * transaction, same as every other enqueue function in this file.
 */
export async function enqueueUpdateOrder(customerId: string, orderId: string, formData: FormData): Promise<OrderEnqueueResult> {
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const fields: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") fields[key] = value;
  });

  // Step 63 / Upgrade — same REQUIRED-list adjustment as enqueueCreateOrder above.
  const REQUIRED = ["orderDate", "totalAmount", "advanceAmount"];
  for (const key of REQUIRED) {
    if (!fields[key] || fields[key].trim() === "") {
      return { queued: false, reason: "invalid-input", message: `${key} is required` };
    }
  }
  const kameezQuantity = Math.max(0, Math.min(20, parseInt(fields.kameezQuantity, 10) || 0));
  // Three-tab Order Type redesign — the form now submits two separate
  // fields (princeCoatQuantity/waistcoatQuantity), no more single
  // combined "coatQuantity" — same fix as order-actions.ts's own
  // validateOrderInput, kept in sync since this is a local-first preview
  // of that same validation.
  const princeCoatQuantity = Math.max(0, Math.min(20, parseInt(fields.princeCoatQuantity, 10) || 0));
  const waistcoatQuantity = Math.max(0, Math.min(20, parseInt(fields.waistcoatQuantity, 10) || 0));
  const coatQuantity = princeCoatQuantity + waistcoatQuantity;
  if (kameezQuantity > 0 && (fields.collarType ? 1 : 0) + (fields.bainType ? 1 : 0) !== 1) {
    return { queued: false, reason: "invalid-input", message: "Select either a Collar or a Bain (not both, and not neither)" };
  }
  if (!MONEY_REGEX.test(fields.totalAmount) || !MONEY_REGEX.test(fields.advanceAmount)) {
    return { queued: false, reason: "invalid-input", message: "Total and Advance Amount must be valid non-negative numbers" };
  }
  if (!isAdvanceWithinTotal(fields.totalAmount, fields.advanceAmount)) {
    return { queued: false, reason: "invalid-input", message: "Advance Amount cannot exceed Total Amount" };
  }
  // Independent sections upgrade — the combined position count across
  // all three sections, same as the server's own `quantity` (order-actions.ts).
  const quantity = kameezQuantity + coatQuantity;

  const db = getOfflineDb();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();
  const balanceAmount = calculateBalance(fields.totalAmount, fields.advanceAmount);

  try {
    await db.transaction("rw", [db.orders, db.orderItems, db.syncQueue], async () => {
      const existingOrder = await db.orders.get(orderId);
      // Placeholder only — same reasoning as enqueueUpdateCustomer's own
      // comment above: prepareItemForDispatch() re-resolves and freezes
      // the real value from the live local record at first dispatch.
      const baseUpdatedAt = existingOrder?.baseUpdatedAt ?? existingOrder?.updatedAt ?? now;

      // Table.update() is a silent no-op if this order isn't in the local
      // mirror yet (e.g. opened for edit without ever having synced down)
      // — harmless here for the same reason enqueueOrderStatusUpdate's own
      // comment explains: the queue item below is what actually delivers
      // the change, and nothing currently renders order specifics from
      // this local row alone.
      await db.orders.update(orderId, {
        deliveryDate: fields.deliveryDate ? new Date(fields.deliveryDate).toISOString() : null,
        measurementMode: "KAMEEZ_SHALWAR",
        suitType: (fields.suitType || null) as SuitType | null,
        collarType: (fields.collarType || null) as CollarType | null,
        bainType: (fields.bainType || null) as BainType | null,
        cuffType: (fields.cuffType || null) as CuffType | null,
        gheraType: (fields.gheraType || null) as GheraType | null,
        pocketOptionId: fields.pocketOptionId || null,
        pattiOptionId: fields.pattiOptionId || null,
        panchaOptionId: fields.panchaOptionId || null,
        totalAmount: fields.totalAmount,
        advanceAmount: fields.advanceAmount,
        balanceAmount,
        princeCoatUnitPrice: fields.princeCoatUnitPrice || null,
        waistcoatUnitPrice: fields.waistcoatUnitPrice || null,
        note: fields.note || null,
        updatedAt: now,
        syncStatus: "pending",
      });

      // Reconcile local orderItems to the new quantity — mirrors the
      // server-side reconciliation in order-update.ts so anything reading
      // this order's local items (e.g. a future local-first Order Detail
      // enhancement) already sees the right shape ahead of sync.
      const existingItems = await db.orderItems.where("orderId").equals(orderId).toArray();
      const extraIds = existingItems.filter((item) => item.position > quantity).map((item) => item.id);
      if (extraIds.length > 0) {
        await db.orderItems.bulkDelete(extraIds);
      }
      for (let position = 1; position <= quantity; position++) {
        const existingItem = existingItems.find((item) => item.position === position);
        const hasStyleOverride = position > 1 && fields[`item.${position}.suitType`] !== undefined;
        const styleFields = hasStyleOverride
          ? {
              suitType: (fields[`item.${position}.suitType`] || null) as SuitType | null,
              collarType: (fields[`item.${position}.collarType`] || null) as CollarType | null,
              bainType: (fields[`item.${position}.bainType`] || null) as BainType | null,
              cuffType: (fields[`item.${position}.cuffType`] || null) as CuffType | null,
              gheraType: (fields[`item.${position}.gheraType`] || null) as GheraType | null,
              pocketOptionId: fields[`item.${position}.pocketOptionId`] || null,
            }
          : { suitType: null, collarType: null, bainType: null, cuffType: null, gheraType: null, pocketOptionId: null };
        // Independent sections upgrade — "COAT" for every position beyond
        // kameezQuantity (the form submits this as a plain hidden field per
        // Coat position, never an admin-facing choice), null otherwise
        // (inherits the order's own measurementMode, which is always
        // KAMEEZ_SHALWAR for every order going forward).
        const itemMeasurementMode = (fields[`item.${position}.measurementMode`] || null) as MeasurementMode | null;
        // Explicit garment selection upgrade — submitted as a plain field
        // per Coat position, same "null for every Kameez/Shalwar position"
        // shape as itemMeasurementMode above.
        const itemCoatGarmentSelection = (fields[`item.${position}.coatGarmentSelection`] || null) as CoatGarmentSelection | null;
        const row: LocalOrderItem = {
          id: existingItem?.id ?? crypto.randomUUID(),
          orderId,
          position,
          // Never guessed locally — only a real sync ever assigns/changes
          // this, same convention as orderNumber/customerCode.
          measurementSnapshotId: existingItem?.measurementSnapshotId ?? null,
          ...styleFields,
          measurementMode: itemMeasurementMode,
          coatGarmentSelection: itemCoatGarmentSelection,
          createdAt: existingItem?.createdAt ?? now,
          updatedAt: now,
          syncStatus: "pending",
        };
        await db.orderItems.put(row);
      }

      const payload: UpdateOrderPayload = { orderId, customerId, fields, baseUpdatedAt };
      const item: SyncQueueItem = {
        op: "UPDATE_ORDER",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
        baselineResolved: false,
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true, id: orderId };
}

// ── Order deletion (Step 55) ────────────────────────────────────────────

export interface DeleteOrderPayload {
  orderId: string;
  customerId: string;
  /**
   * Captured at enqueue time, BEFORE the local order row is deleted —
   * structurally never re-resolvable at dispatch time the way
   * UPDATE_CUSTOMER/UPDATE_ORDER/UPDATE_ORDER_STATUS's baselines are
   * (there is no live local row left to re-read once this function
   * returns). Used as-is, unchanged, for every attempt of this item,
   * including retries — exactly the enqueue-time-freeze behavior every
   * other op had before the baseline-freeze redesign, kept here because
   * it is the only value that is actually available. The one accepted
   * consequence: if a sibling operation on this same order completes
   * between this item's enqueue and its first dispatch, this delete's
   * baseline can be stale relative to the server's current state —
   * which surfaces as an ordinary, safely-resolvable conflict (never a
   * silent wrong delete), not a correctness bug.
   */
  baseUpdatedAt: string;
}

export interface OrderDeleteEnqueueResult {
  queued: boolean;
  reason?: "no-indexeddb" | "storage-error";
  message?: string;
}

/**
 * Local-first order deletion (Step 55, Rule A: this NEVER touches the
 * customer — only ever this one order's own local rows). Deletes the
 * order and its items from Dexie immediately (optimistic — "local
 * storage is the source of truth", same principle every other local-
 * first write in this file already follows), then queues a DELETE_ORDER
 * item. Local write + queue insertion happen in ONE Dexie transaction,
 * same as every other enqueue function here — the order can never be
 * "gone from the UI" without a queued item that will actually deliver
 * that deletion to the server, even across a crash.
 *
 * No local pre-validation beyond "does IndexedDB exist" — there is
 * nothing to validate about a delete request itself (no form fields),
 * unlike create/update.
 */
export async function enqueueDeleteOrder(customerId: string, orderId: string): Promise<OrderDeleteEnqueueResult> {
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const db = getOfflineDb();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();

  try {
    await db.transaction("rw", [db.orders, db.orderItems, db.syncQueue], async () => {
      // Must read this BEFORE deleting the local row below — there is no
      // live local record left to consult afterward (see
      // DeleteOrderPayload.baseUpdatedAt's own comment).
      const existingOrder = await db.orders.get(orderId);
      const baseUpdatedAt = existingOrder?.baseUpdatedAt ?? existingOrder?.updatedAt ?? now;

      await db.orders.delete(orderId);
      await db.orderItems.where("orderId").equals(orderId).delete();

      const payload: DeleteOrderPayload = { orderId, customerId, baseUpdatedAt };
      const item: SyncQueueItem = {
        op: "DELETE_ORDER",
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey,
        createdAt: Date.now(),
      };
      await db.syncQueue.add(item);
    });
  } catch (error) {
    return { queued: false, reason: "storage-error", message: describeOfflineStorageError(error) };
  }

  return { queued: true };
}

// ── Queue processor ─────────────────────────────────────────────────────
//
// Dependency ordering note (Phase 6): the same FIFO-by-createdAt
// reasoning documented in this file's header for CREATE_CUSTOMER ->
// UPDATE_CUSTOMER applies identically to CREATE_CUSTOMER -> CREATE_ORDER
// and CREATE_CUSTOMER -> SAVE_MEASUREMENT. A measurement or order can
// only ever be created (via the UI) for a customer that already exists
// locally, so its queue item is always enqueued — and therefore always
// has a later createdAt — after that customer's own CREATE_CUSTOMER
// item. The processor's unchanged strict FIFO drain below guarantees
// the customer's create is always attempted (and, given connectivity,
// synced) first. If it permanently fails, the dependent
// SAVE_MEASUREMENT/CREATE_ORDER item fails safely and visibly with
// "customer-not-found" (see measurement-sync.ts / order-create-sync.ts)
// rather than silently corrupting anything — never a second queue, never
// a dependency-graph system, per the Phase 6 task's own explicit
// instruction. See the Phase 6 report for the full analysis and the
// real (not simulated) test that exercises this ordering.

const MAX_ATTEMPTS = 5;
// Delay before attempts 2/3/4 respectively; attempt 4's failure uses the
// last value again for the wait before attempt 5, which — if it also
// fails — is marked "failed" (see the Phase 4 task's own example
// schedule: "Attempt 2 -> ~5s, Attempt 3 -> ~15s, Attempt 4 -> ~45s,
// Attempt 5 -> then mark failed").
const BACKOFF_MS = [5000, 15000, 45000];

let isProcessing = false;
const pendingRetryTimers = new Set<ReturnType<typeof setTimeout>>();

// Phase 9 — the two small decision rules processSyncQueue() itself has
// always applied (Phase 4), extracted into plain functions purely so
// they're directly testable without a browser/IndexedDB (see
// test-phase9.mjs) — processSyncQueue()'s own behavior below is
// unchanged, it just now delegates to these instead of repeating the
// same logic inline.

/** Strict FIFO by `createdAt` among "pending" items — same ordering rule the live processor has always used (Phase 4). */
export function selectNextPendingItem(items: SyncQueueItem[]): SyncQueueItem | undefined {
  return items.filter((item) => item.status === "pending").sort((a, b) => a.createdAt - b.createdAt)[0];
}

/** Which item ids are stuck "sending" (interrupted by a refresh/crash/close) and need recovering back to "pending" — same recovery rule the live processor has always run at the start of every call (Phase 4 §5/§12). */
export function findStuckSendingItemIds(items: SyncQueueItem[]): number[] {
  return items.filter((item): item is SyncQueueItem & { id: number } => item.status === "sending" && item.id !== undefined).map((item) => item.id);
}

/**
 * Reads the live local record's confirmed baseline for an item that
 * hasn't been frozen yet. Three distinct outcomes, each handled
 * differently by prepareItemForDispatch():
 *   - a non-empty string: the real baseline to freeze and send.
 *   - `null`: the record genuinely has no usable baseline (missing
 *     entirely, or present with `baseUpdatedAt` still null/empty) — a
 *     permanent, fail-closed condition (dispatchBlocked).
 *   - throws: a transient read failure (e.g. the IndexedDB transaction
 *     itself failed) — must stay retryable, never treated as "missing".
 * UPDATE_CUSTOMER, UPDATE_ORDER, and UPDATE_ORDER_STATUS all use a live-
 * re-readable baseline (their local record stays live the whole time).
 * DELETE_ORDER does NOT go through this function at all — its local
 * order row is deleted at enqueue time, so there is nothing left to
 * re-read; its baseline is captured once, at enqueue, and used as-is
 * (see DeleteOrderPayload.baseUpdatedAt's own comment).
 */
async function readLiveBaseline(item: SyncQueueItem): Promise<string | null> {
  const db = getOfflineDb();
  if (item.op === "UPDATE_ORDER" || item.op === "UPDATE_ORDER_STATUS") {
    const payload = item.payload as UpdateOrderPayload | UpdateOrderStatusPayload;
    const order = await db.orders.get(payload.orderId);
    return order?.baseUpdatedAt || null;
  }
  if (item.op === "UPDATE_CUSTOMER") {
    const payload = item.payload as UpdateCustomerPayload;
    const customer = await db.customers.get(payload.customerId);
    return customer?.baseUpdatedAt || null;
  }
  return null;
}

/** Dependencies prepareItemForDispatch() needs — injected so it's testable with fakes, no Dexie/browser required. */
export interface DispatchPrepDeps {
  readLiveBaseline: (item: SyncQueueItem) => Promise<string | null>;
  /** Mirrors Dexie's own Table.update() contract: resolves to the number of records actually modified (0 or 1 here). */
  persist: (id: number, fields: Partial<SyncQueueItem>) => Promise<number>;
}

export type DispatchPrepResult =
  | { ok: true; itemToSend: SyncQueueItem }
  // The live record has no usable baseline at all — permanent, fails
  // closed. Never falls back to the stale item.payload.baseUpdatedAt.
  | { ok: false; reason: "missing-record" }
  // readLiveBaseline() itself threw (a transient storage error, not a
  // missing record) — must stay retryable, never dispatchBlocked.
  | { ok: false; reason: "transient-read-error"; message: string }
  // The persistence write didn't report exactly one modified record —
  // never proceed to send on an unconfirmed write.
  | { ok: false; reason: "persist-failed" };

/**
 * Resolves and freezes this item's baseline (if not already frozen),
 * persists that + the "sending" transition in one write, and returns the
 * exact object to pass to sendQueueItem() — never the original, possibly
 * stale in-memory `item` (Table.update() only patches the stored IndexedDB
 * record; it does not mutate the object already in memory). The network
 * is only ever contacted after this resolves `ok: true`.
 */
const OPS_WITH_LIVE_BASELINE: readonly SyncOp[] = ["UPDATE_ORDER", "UPDATE_CUSTOMER", "UPDATE_ORDER_STATUS"];

export async function prepareItemForDispatch(item: SyncQueueItem, deps: DispatchPrepDeps): Promise<DispatchPrepResult> {
  if (item.baselineResolved || !OPS_WITH_LIVE_BASELINE.includes(item.op)) {
    const count = await deps.persist(item.id as number, { status: "sending" });
    if (count !== 1) return { ok: false, reason: "persist-failed" };
    return { ok: true, itemToSend: item };
  }

  let liveBaseline: string | null;
  try {
    liveBaseline = await deps.readLiveBaseline(item);
  } catch (err) {
    return { ok: false, reason: "transient-read-error", message: err instanceof Error ? err.message : String(err) };
  }
  if (!liveBaseline) {
    return { ok: false, reason: "missing-record" };
  }

  const updateFields: Partial<SyncQueueItem> = {
    status: "sending",
    baselineResolved: true,
    payload: { ...(item.payload as Record<string, unknown>), baseUpdatedAt: liveBaseline },
  };
  const count = await deps.persist(item.id as number, updateFields);
  if (count !== 1) return { ok: false, reason: "persist-failed" };
  return { ok: true, itemToSend: { ...item, ...updateFields } };
}

export interface ProcessResult {
  processedCount: number;
  syncedCount: number;
  authRequired: boolean;
}

const EMPTY_RESULT: ProcessResult = { processedCount: 0, syncedCount: 0, authRequired: false };

/**
 * Drains the syncQueue: single-flight (only one item is ever actively
 * being sent at a time — a concurrent call while one is already running
 * is a harmless no-op, not a second parallel drain), strict FIFO by
 * `createdAt` (this is an explicitly single-device application; no
 * cross-item ordering complexity is needed). Safe to call as often as
 * useful — right after enqueueing something, on an `online` event, or on
 * app load to recover anything left over from a previous session.
 */
export async function processSyncQueue(): Promise<ProcessResult> {
  if (!isOfflineDbAvailable()) return EMPTY_RESULT;
  if (isProcessing) return EMPTY_RESULT;
  isProcessing = true;

  const db = getOfflineDb();
  let processedCount = 0;
  let syncedCount = 0;
  let authRequired = false;

  try {
    // Interrupted-sync recovery (Phase 4 §5/§12): anything left "sending"
    // from a previous run — browser refresh, tab close, crash, or the
    // connection dropping mid-request — is retryable, never permanently
    // lost. Reset before draining so this run's own FIFO loop picks these
    // up naturally alongside genuinely new "pending" items.
    const stuck = await db.syncQueue.where("status").equals("sending").toArray();
    for (const id of findStuckSendingItemIds(stuck)) {
      await db.syncQueue.update(id, { status: "pending" });
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pending = await db.syncQueue.where("status").equals("pending").toArray();
      const item = selectNextPendingItem(pending);
      if (!item || item.id === undefined) break;

      processedCount++;

      const prep = await prepareItemForDispatch(item, {
        readLiveBaseline,
        persist: (id, fields) => db.syncQueue.update(id, fields),
      });

      if (!prep.ok) {
        if (prep.reason === "missing-record") {
          // Fails closed, permanently — never falls back to the stale
          // item.payload.baseUpdatedAt. Should be unreachable under
          // correct operation (the dependency-closure tracking is what's
          // supposed to guarantee this record exists); if it fires, it's
          // a real anomaly needing manual review, not something blind
          // retry could ever fix.
          await db.syncQueue.update(item.id, {
            status: "failed",
            dispatchBlocked: true,
            lastError: "Could not establish a safe version baseline for this update — the local record may be missing. Needs manual review.",
          });
          continue;
        }
        if (prep.reason === "persist-failed") {
          // The item vanished/changed under us between selection and
          // this write — status in Dexie is unaffected either way; skip
          // it this run rather than guess, the next run will reselect it.
          continue;
        }
        // "transient-read-error" — a storage read failure, NOT a missing
        // record. Must stay retryable, same backoff treatment as an
        // ordinary network/5xx failure below, never dispatchBlocked.
        const attempts = item.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await db.syncQueue.update(item.id, { status: "failed", attempts, lastError: prep.message });
          continue;
        }
        await db.syncQueue.update(item.id, { status: "pending", attempts, lastError: prep.message });
        const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
        const timer = setTimeout(() => {
          pendingRetryTimers.delete(timer);
          processSyncQueue().catch(() => {});
        }, delay);
        pendingRetryTimers.add(timer);
        break;
      }

      const itemToSend = prep.itemToSend;
      const outcome = await sendQueueItem(itemToSend);

      if (outcome.kind === "success") {
        await db.syncQueue.update(item.id, { status: "synced", lastError: null });
        if (item.op === "UPDATE_ORDER_STATUS") {
          const payload = item.payload as UpdateOrderStatusPayload;
          const data = outcome.data as { updatedAt?: string } | undefined;
          // Best-effort — see the same "may not exist locally yet" note
          // in enqueueOrderStatusUpdate() above. baseUpdatedAt advances
          // here too — same "this device's own successful sync of a
          // sibling operation" rule as UPDATE_CUSTOMER/UPDATE_ORDER.
          await db.orders
            .update(payload.orderId, { syncStatus: "synced", ...(data?.updatedAt ? { updatedAt: data.updatedAt, baseUpdatedAt: data.updatedAt } : {}) })
            .catch(() => {});
        } else if (item.op === "CREATE_CUSTOMER") {
          const payload = item.payload as CreateCustomerPayload;
          const data = outcome.data as { customerCode?: string } | undefined;
          // The id never changes (Phase 5 §D) — only customerCode
          // (previously null) and syncStatus are updated in place.
          if (data?.customerCode) {
            await db.customers.update(payload.id, { customerCode: data.customerCode, syncStatus: "synced" }).catch(() => {});
          } else {
            await db.customers.update(payload.id, { syncStatus: "synced" }).catch(() => {});
          }
        } else if (item.op === "UPDATE_CUSTOMER") {
          const payload = item.payload as UpdateCustomerPayload;
          const data = outcome.data as { updatedAt?: string } | undefined;
          // baseUpdatedAt advances here too — this is exactly "this
          // device's own successful sync of a sibling operation" (see
          // LocalCustomer.baseUpdatedAt's own comment), the one thing
          // besides an initial-sync pull allowed to move it.
          await db.customers
            .update(payload.customerId, {
              syncStatus: "synced",
              ...(data?.updatedAt ? { updatedAt: data.updatedAt, baseUpdatedAt: data.updatedAt } : {}),
            })
            .catch(() => {});
        } else if (item.op === "SAVE_MEASUREMENT") {
          const payload = item.payload as SaveMeasurementPayload;
          const data = outcome.data as { updatedAt?: string } | undefined;
          await db.measurements
            .where("customerId")
            .equals(payload.customerId)
            .modify({ syncStatus: "synced", ...(data?.updatedAt ? { updatedAt: data.updatedAt } : {}) })
            .catch(() => {});
        } else if (item.op === "SAVE_COAT_MEASUREMENT") {
          const payload = item.payload as SaveCoatMeasurementPayload;
          const data = outcome.data as { updatedAt?: string } | undefined;
          await db.coatMeasurements
            .where("customerId")
            .equals(payload.customerId)
            .modify({ syncStatus: "synced", ...(data?.updatedAt ? { updatedAt: data.updatedAt } : {}) })
            .catch(() => {});
        } else if (item.op === "CREATE_ORDER") {
          const payload = item.payload as CreateOrderPayload;
          const data = outcome.data as { orderNumber?: string; updatedAt?: string } | undefined;
          // The id never changes (Phase 6 §B) — only orderNumber
          // (previously null) and syncStatus are updated in place, same
          // pattern as CREATE_CUSTOMER above. Step 53 — updatedAt is also
          // captured here now (when the server returns one) so this
          // order's local row has a real, server-accurate baseline the
          // moment it syncs — this is what lets a subsequent Edit Order
          // (enqueueUpdateOrder above) use it as a trustworthy
          // baseUpdatedAt instead of falling back to a guess.
          await db.orders
            .update(payload.id, {
              syncStatus: "synced",
              ...(data?.orderNumber ? { orderNumber: data.orderNumber } : {}),
              ...(data?.updatedAt ? { updatedAt: data.updatedAt, baseUpdatedAt: data.updatedAt } : {}),
            })
            .catch(() => {});
        } else if (item.op === "UPDATE_ORDER") {
          const payload = item.payload as UpdateOrderPayload;
          const data = outcome.data as { updatedAt?: string } | undefined;
          // baseUpdatedAt advances here too — same "sibling operation's
          // own successful sync" rule as UPDATE_CUSTOMER above.
          await db.orders
            .update(payload.orderId, {
              syncStatus: "synced",
              ...(data?.updatedAt ? { updatedAt: data.updatedAt, baseUpdatedAt: data.updatedAt } : {}),
            })
            .catch(() => {});
          // Best-effort — local items were already written in the shape
          // the server now agrees with; only their sync flag needs
          // updating.
          await db.orderItems
            .where("orderId")
            .equals(payload.orderId)
            .modify({ syncStatus: "synced" })
            .catch(() => {});
        }
        syncedCount++;
        continue;
      }

      if (outcome.kind === "conflict") {
        // Customer/order edit conflict (Phase 5 §H, extended to orders in
        // Step 53): the server refused to apply this update because the
        // record changed elsewhere since this edit was based on it.
        // Never silently overwritten. The queue item is preserved (not
        // deleted, not retried forever) and the local row keeps the
        // "conflict" syncStatus.
        //
        // `conflictServerUpdatedAt` is what turns this from a dead end
        // into something resolvable: it records the server's current
        // updatedAt so resolveConflictKeepLocal() has a valid baseline
        // to re-submit against, and it marks this item as a CONFLICT
        // rather than a plain failure so retryFailedQueueItems() stops
        // resending it on a loop that can never succeed. See
        // resolveConflictKeepLocal / resolveConflictUseServer below.
        await db.syncQueue.update(item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          lastError: outcome.message,
          conflictServerUpdatedAt: outcome.serverUpdatedAt ?? "",
        });
        if (item.op === "UPDATE_CUSTOMER") {
          const payload = item.payload as UpdateCustomerPayload;
          await db.customers.update(payload.customerId, { syncStatus: "conflict" }).catch(() => {});
        } else if (item.op === "UPDATE_ORDER" || item.op === "UPDATE_ORDER_STATUS") {
          const payload = item.payload as UpdateOrderPayload | UpdateOrderStatusPayload;
          await db.orders.update(payload.orderId, { syncStatus: "conflict" }).catch(() => {});
        }
        // DELETE_ORDER: no local order row exists to flag (already
        // deleted at enqueue time) — the conflict is still visible and
        // resolvable through the queue-item list (readConflicts()
        // below), just not through a customer/order-page badge.
        continue;
      }

      if (outcome.kind === "auth-required") {
        // Distinct from a network/server failure (Phase 4 §14): the
        // item stays safely queued (back to "pending", not "failed"),
        // but retrying immediately would just hit the same 401 again —
        // stop this run rather than spin uselessly. A later call to
        // processSyncQueue() (e.g. after the owner logs back in) will
        // pick this item straight back up.
        await db.syncQueue.update(item.id, {
          status: "pending",
          lastError: "Authentication required to sync pending changes.",
        });
        authRequired = true;
        break;
      }

      if (outcome.kind === "idempotency-key-reuse") {
        // UPDATE_ORDER only — the server already has a committed receipt
        // for this operationId under a DIFFERENT payload. Permanent,
        // never a stale-version conflict: deliberately does NOT set
        // conflictServerUpdatedAt (so isConflictItem() stays false — this
        // must never reach readConflicts()/resolveConflictKeepLocal/
        // resolveConflictUseServer, which all assume a real server
        // baseline exists to rebase onto; there isn't one here). Should
        // never happen under correct client operation — needs manual
        // review, not blind retry.
        await db.syncQueue.update(item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          idempotencyKeyReuse: true,
          lastError: outcome.message,
        });
        continue;
      }

      if (outcome.kind === "rejected") {
        // 4xx validation/business failure — never retried automatically
        // (Phase 4 §15): the server has already told us this exact
        // request is invalid, so sending it again unchanged would only
        // ever fail the same way.
        await db.syncQueue.update(item.id, {
          status: "failed",
          attempts: item.attempts + 1,
          lastError: outcome.message,
        });
        continue;
      }

      // outcome.kind === "retryable" (network failure or 5xx)
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.syncQueue.update(item.id, { status: "failed", attempts, lastError: outcome.message });
        continue;
      }
      await db.syncQueue.update(item.id, { status: "pending", attempts, lastError: outcome.message });
      const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      const timer = setTimeout(() => {
        pendingRetryTimers.delete(timer);
        processSyncQueue().catch(() => {});
      }, delay);
      pendingRetryTimers.add(timer);
      // Stop this run — the timer above will re-enter and pick this
      // (and anything else still pending) back up after the backoff.
      break;
    }
  } finally {
    isProcessing = false;
  }

  return { processedCount, syncedCount, authRequired };
}

// ── Failed-item retry (Phase 9 §5) ──────────────────────────────────────

export interface RetryResult {
  retriedCount: number;
}

/**
 * Moves every "failed" queue item back to "pending" so the next
 * processSyncQueue() call (the caller is expected to trigger one right
 * after — see sync-status-indicator.tsx's "Retry failed" button)
 * attempts it again. Reuses the SAME queue item: same `id`, same
 * `idempotencyKey`, same `payload` — nothing here creates a new entry
 * or regenerates any identifier, exactly like every existing retry path
 * in processSyncQueue() itself.
 *
 * Resets `attempts` back to 0 so a deliberate, explicit user action
 * gets a fresh full backoff budget rather than being one bad attempt
 * away from immediately re-exhausting whatever count it already had —
 * the automatic bounded-retry behavior for ordinary network hiccups
 * (processSyncQueue's own MAX_ATTEMPTS logic) is completely unchanged
 * and still applies in full to whatever happens on this next attempt.
 *
 * Deliberately does NOT touch `lastError` — the failure reason stays
 * visible until the retry actually runs and either clears it (success)
 * or replaces it with a fresh message (failure again). Also does not
 * try to distinguish a "conflict" failure from any other kind: retrying
 * a still-genuinely-conflicting item is safe (the server's existing
 * conflict guard in customer-sync.ts just rejects it again, identically
 * — no data is ever silently overwritten), it just won't itself resolve
 * anything, matching this phase's explicit "no conflict-resolution
 * editor" scope.
 */
// ── Conflict resolution ────────────────────────────────────────────────
//
// A conflict means the server refused an edit because the record changed
// elsewhere after this edit was based on it. Until now the app could
// DETECT that and say so, but offered no way out: the queue item sat at
// "failed" forever, "Retry failed" resent it with the same stale baseline
// so it failed identically every time, and the only real escape was
// clearing browser storage — which throws the unsynced edit away. These
// two functions are the way out, and they are the only two honest
// options: the user's version wins, or the server's does.

/**
 * A conflicted queue item, as opposed to an ordinary failure. Both share
 * `status: "failed"`; only a conflict carries conflictServerUpdatedAt
 * (set, possibly to "" when the server didn't include one).
 */
function isConflictItem(item: SyncQueueItem): boolean {
  return item.status === "failed" && item.conflictServerUpdatedAt !== undefined;
}

export interface ConflictEntry {
  queueItemId: number;
  op: SyncOp;
  /** Which record this edit was for — used to look up a human name for it. */
  recordId: string;
  /** "customer" | "order" — which local table `recordId` belongs to. */
  recordType: "customer" | "order";
  /** The server's message from the 409, shown as-is. */
  message: string;
  /** True when the server gave us a baseline, i.e. "keep mine" can work. */
  canKeepLocal: boolean;
}

/**
 * Every unresolved conflict, for the resolution UI. Reads only the
 * existing syncQueue table — no new table, no new index.
 */
export async function readConflicts(): Promise<ConflictEntry[]> {
  if (!isOfflineDbAvailable()) return [];
  const db = getOfflineDb();
  await db.open();

  const failed = await db.syncQueue.where("status").equals("failed").toArray();
  const entries: ConflictEntry[] = [];

  for (const item of failed) {
    if (!isConflictItem(item) || item.id === undefined) continue;

    // UPDATE_CUSTOMER, UPDATE_ORDER, UPDATE_ORDER_STATUS, and
    // DELETE_ORDER can all conflict — every op that sends a
    // baseUpdatedAt for the server to check.
    if (item.op === "UPDATE_CUSTOMER") {
      const payload = item.payload as UpdateCustomerPayload;
      entries.push({
        queueItemId: item.id,
        op: item.op,
        recordId: payload.customerId,
        recordType: "customer",
        message: item.lastError ?? "",
        canKeepLocal: !!item.conflictServerUpdatedAt,
      });
    } else if (item.op === "UPDATE_ORDER" || item.op === "UPDATE_ORDER_STATUS" || item.op === "DELETE_ORDER") {
      const payload = item.payload as UpdateOrderPayload | UpdateOrderStatusPayload | DeleteOrderPayload;
      entries.push({
        queueItemId: item.id,
        op: item.op,
        recordId: payload.orderId,
        recordType: "order",
        message: item.lastError ?? "",
        canKeepLocal: !!item.conflictServerUpdatedAt,
      });
    }
  }

  return entries;
}

export type ResolveResult = { ok: true } | { ok: false; message: string };

/**
 * Keep the local (user's) version: re-base this edit on the server's
 * CURRENT updatedAt and send it again, so the server accepts it as a
 * normal update instead of refusing it as stale.
 *
 * This is a deliberate overwrite of whatever changed on the server, which
 * is exactly what the user asked for by choosing this — so the UI must
 * name that clearly before calling it.
 */
export async function resolveConflictKeepLocal(queueItemId: number): Promise<ResolveResult> {
  if (!isOfflineDbAvailable()) {
    return { ok: false, message: "Local storage is not available in this browser." };
  }
  const db = getOfflineDb();
  await db.open();

  const item = await db.syncQueue.get(queueItemId);
  if (!item || !isConflictItem(item)) {
    return { ok: false, message: "That conflict is no longer waiting to be resolved." };
  }
  const serverUpdatedAt = item.conflictServerUpdatedAt;
  if (!serverUpdatedAt) {
    // The server reported a conflict without telling us its current
    // version. Re-sending would just conflict again, so say so plainly
    // rather than appear to act.
    return {
      ok: false,
      message: "The server didn't report its current version, so this edit can't be re-applied. Use the server's version instead.",
    };
  }

  // Rewrite the baseline in place. Everything else about the payload —
  // the actual edited values — is untouched, so this re-sends the user's
  // own edit, not a reconstruction of it.
  const payload = { ...(item.payload as Record<string, unknown>), baseUpdatedAt: serverUpdatedAt };

  await db.syncQueue.update(queueItemId, {
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    // This rebase itself supplies an authoritative baseline (the
    // server's own reported current updatedAt) — prepareItemForDispatch
    // must not re-read the live local record over the top of it, so this
    // is set directly rather than left for dispatch to resolve. Safe
    // under the receipt design: reaching this function at all required
    // the server to have found no matching receipt for this item's
    // operationId (that's what makes it a real, surfaced conflict rather
    // than a silent replay), so resending under the same operationId
    // here can never collide with a prior commit.
    baselineResolved: true,
    // No longer a conflict — clearing this returns the item to the
    // ordinary pending/failed lifecycle.
    conflictServerUpdatedAt: undefined,
  });

  // Back to "pending" on the record too, so the UI stops showing it as
  // needing attention the moment the decision is made.
  if (item.op === "UPDATE_CUSTOMER") {
    const p = item.payload as UpdateCustomerPayload;
    await db.customers.update(p.customerId, { syncStatus: "pending" }).catch(() => {});
  } else if (item.op === "UPDATE_ORDER" || item.op === "UPDATE_ORDER_STATUS") {
    const p = item.payload as UpdateOrderPayload | UpdateOrderStatusPayload;
    await db.orders.update(p.orderId, { syncStatus: "pending" }).catch(() => {});
  }
  // DELETE_ORDER: no local order row exists to flag back to "pending" —
  // it was already removed from Dexie at enqueue time. The rebased
  // payload (baselineResolved: true, above) is all this item needs;
  // processSyncQueue() below will deliver it.

  await processSyncQueue();
  return { ok: true };
}

/**
 * Take the server's version: discard this local edit entirely.
 *
 * The queue item is deleted and the local row is marked "synced" so the
 * next initial sync is free to overwrite it with server values —
 * initial-sync.ts deliberately refuses to overwrite a row that is
 * "pending" or "conflict" (so it can never clobber a real unsent edit),
 * which is why the flag has to be cleared here for the pull to take
 * effect.
 *
 * Destructive to the local edit by design, which is the whole point of
 * the choice — the UI must say so before calling it.
 */
export async function resolveConflictUseServer(queueItemId: number): Promise<ResolveResult> {
  if (!isOfflineDbAvailable()) {
    return { ok: false, message: "Local storage is not available in this browser." };
  }
  const db = getOfflineDb();
  await db.open();

  const item = await db.syncQueue.get(queueItemId);
  if (!item || !isConflictItem(item)) {
    return { ok: false, message: "That conflict is no longer waiting to be resolved." };
  }

  await db.syncQueue.delete(queueItemId);

  if (item.op === "UPDATE_CUSTOMER") {
    const p = item.payload as UpdateCustomerPayload;
    await db.customers.update(p.customerId, { syncStatus: "synced" }).catch(() => {});
  } else if (item.op === "UPDATE_ORDER" || item.op === "UPDATE_ORDER_STATUS") {
    const p = item.payload as UpdateOrderPayload | UpdateOrderStatusPayload;
    await db.orders.update(p.orderId, { syncStatus: "synced" }).catch(() => {});
  }
  // DELETE_ORDER: no local row to mark — it's already gone. Deleting
  // this queue item above is itself what unblocks the re-pull below:
  // pendingDeleteOrderIds() (initial-sync.ts) only skips re-pulling an
  // order while a NON-synced DELETE_ORDER item for it still exists in
  // this same queue, and this one no longer does.

  // Pull the server's actual values down now, rather than leaving the
  // local row showing the discarded edit until the next app load. Safe
  // to call at any time — its own header documents that it is re-called
  // on every app load, and with the flag cleared above it will now
  // overwrite this row instead of skipping it. Best-effort: if it fails
  // (offline), the row is already marked "synced" so the next load's
  // own initial sync picks it up.
  await runInitialSync().catch(() => {});

  return { ok: true };
}

export async function retryFailedQueueItems(): Promise<RetryResult> {
  if (!isOfflineDbAvailable()) return { retriedCount: 0 };
  const db = getOfflineDb();
  const failed = await db.syncQueue.where("status").equals("failed").toArray();
  // Conflicts live at `status: "failed"` too, but they are NOT retryable:
  // resending one unchanged means resending the same stale baseUpdatedAt,
  // which the server refuses for exactly the same reason it refused the
  // first time. Retrying them produced an endless loop that looked like
  // the app trying and never reporting why. They are excluded here and
  // resolved explicitly instead (resolveConflictKeepLocal /
  // resolveConflictUseServer). idempotencyKeyReuse and dispatchBlocked
  // are excluded for the same underlying reason: both are permanent —
  // resending the identical frozen payload (idempotencyKeyReuse) or
  // retrying a dispatch that never had a safe baseline to send
  // (dispatchBlocked) would only ever fail the same way again.
  const retryable = failed.filter((item) => !isConflictItem(item) && !item.idempotencyKeyReuse && !item.dispatchBlocked);
  for (const item of retryable) {
    if (item.id !== undefined) {
      await db.syncQueue.update(item.id, { status: "pending", attempts: 0 });
    }
  }
  return { retriedCount: retryable.length };
}

type SendOutcome =
  | { kind: "success"; data?: unknown }
  | { kind: "auth-required" }
  // serverUpdatedAt is the record's CURRENT server updatedAt, returned
  // in the 409 body. It was previously thrown away, which is precisely
  // what made a conflict unresolvable: without it there is no correct
  // baseline to re-submit an overwrite against.
  | { kind: "conflict"; message: string; serverUpdatedAt?: string }
  // UPDATE_ORDER only — the server's receipt table already has a
  // committed result for this operationId under a DIFFERENT payload
  // hash. Permanent, never a stale-version conflict: classified by the
  // explicit `code: "idempotency-key-reuse"` in the 422 body, never by
  // status code alone (other business-rule rejections could plausibly
  // also use 422 in the future without meaning this).
  | { kind: "idempotency-key-reuse"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "retryable"; message: string };

/** Endpoint + body for each supported op — the one place that maps a queue op to its /api/sync/* Route Handler. */
function requestFor(item: SyncQueueItem): { url: string; body: unknown } | null {
  switch (item.op) {
    case "UPDATE_ORDER_STATUS":
      return {
        url: "/api/sync/order-status",
        body: { ...(item.payload as UpdateOrderStatusPayload), idempotencyKey: item.idempotencyKey },
      };
    case "CREATE_CUSTOMER":
      return {
        url: "/api/sync/customer-create",
        body: { ...(item.payload as CreateCustomerPayload), idempotencyKey: item.idempotencyKey },
      };
    case "UPDATE_CUSTOMER":
      return {
        url: "/api/sync/customer-update",
        body: { ...(item.payload as UpdateCustomerPayload), idempotencyKey: item.idempotencyKey },
      };
    case "SAVE_MEASUREMENT":
      return {
        url: "/api/sync/measurement",
        body: { ...(item.payload as SaveMeasurementPayload), idempotencyKey: item.idempotencyKey },
      };
    case "SAVE_COAT_MEASUREMENT":
      return {
        url: "/api/sync/coat-measurement",
        body: { ...(item.payload as SaveCoatMeasurementPayload), idempotencyKey: item.idempotencyKey },
      };
    case "CREATE_ORDER": {
      // A real FormData body, not JSON — see order-create-sync.ts's file
      // header. sendQueueItem() below sends this as multipart/form-data
      // instead of JSON when it detects a FormData instance.
      const payload = item.payload as CreateOrderPayload;
      const body = new FormData();
      for (const [key, value] of Object.entries(payload.fields)) {
        body.set(key, value);
      }
      body.set("__clientOrderId", payload.id);
      body.set("__customerId", payload.customerId);
      return { url: "/api/sync/order-create", body };
    }
    case "UPDATE_ORDER": {
      // Same FormData-body reasoning as CREATE_ORDER above.
      const payload = item.payload as UpdateOrderPayload;
      const body = new FormData();
      for (const [key, value] of Object.entries(payload.fields)) {
        body.set(key, value);
      }
      body.set("__orderId", payload.orderId);
      body.set("__customerId", payload.customerId);
      body.set("__baseUpdatedAt", payload.baseUpdatedAt);
      body.set("__idempotencyKey", item.idempotencyKey);
      return { url: "/api/sync/order-update", body };
    }
    case "DELETE_ORDER": {
      const payload = item.payload as DeleteOrderPayload;
      return {
        url: "/api/sync/order-delete",
        body: { customerId: payload.customerId, orderId: payload.orderId, baseUpdatedAt: payload.baseUpdatedAt },
      };
    }
    default:
      return null;
  }
}

/**
 * Sends exactly one queue item to its matching /api/sync/* endpoint.
 * Phase 4 added UPDATE_ORDER_STATUS; Phase 5 adds CREATE_CUSTOMER and
 * UPDATE_CUSTOMER — each op maps to its own endpoint via requestFor()
 * above. A future phase adding a new `op` extends that mapping rather
 * than replacing this function's request/response handling.
 */
async function sendQueueItem(item: SyncQueueItem): Promise<SendOutcome> {
  const op: SyncOp = item.op;
  const request = requestFor(item);
  if (!request) {
    return { kind: "rejected", message: `Unsupported op in this phase: ${op}` };
  }

  // CREATE_ORDER's body is a real FormData (Phase 6) — sent as
  // multipart/form-data so the Route Handler can call
  // validateOrderInput(formData) unchanged. Every other op's body is a
  // plain JSON-serializable object, unchanged from Phase 4/5. fetch()
  // sets its own multipart boundary header automatically for a FormData
  // body; setting Content-Type manually in that case would omit the
  // boundary and break parsing.
  const isFormDataBody = typeof FormData !== "undefined" && request.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      ...(isFormDataBody ? {} : { headers: { "Content-Type": "application/json" } }),
      body: isFormDataBody ? (request.body as FormData) : JSON.stringify(request.body),
    });
  } catch (err) {
    return { kind: "retryable", message: err instanceof Error ? err.message : String(err) };
  }

  if (response.status === 401) {
    return { kind: "auth-required" };
  }
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    return {
      kind: "conflict",
      message: (body && body.error) || "Conflict: this record was changed elsewhere",
      serverUpdatedAt: typeof body?.serverUpdatedAt === "string" ? body.serverUpdatedAt : undefined,
    };
  }
  if (response.status === 422) {
    const body = await response.json().catch(() => null);
    // The machine-readable `code` is the actual discriminator, never the
    // bare status — a future, unrelated validation error could plausibly
    // also return 422 without meaning "idempotency key reuse".
    if (body?.code === "idempotency-key-reuse") {
      return { kind: "idempotency-key-reuse", message: (body && body.error) || "This change was already recorded under a different request." };
    }
    return { kind: "rejected", message: (body && body.error) || "Server responded 422" };
  }
  if (response.ok) {
    const data = await response.json().catch(() => undefined);
    return { kind: "success", data };
  }
  if (response.status >= 500) {
    return { kind: "retryable", message: `Server responded ${response.status}` };
  }

  const body = await response.json().catch(() => null);
  return { kind: "rejected", message: (body && body.error) || `Server responded ${response.status}` };
}
