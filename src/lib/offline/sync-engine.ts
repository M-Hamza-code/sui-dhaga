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
import { getOfflineDb, isOfflineDbAvailable } from "./db";
import type {
  SyncQueueItem,
  SyncOp,
  LocalCustomer,
  LocalMeasurement,
  LocalOrder,
  LocalOrderItem,
  SuitType,
  CollarType,
  BainType,
  CuffType,
  GheraType,
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
import { MONEY_REGEX, calculateBalance } from "@/lib/money";

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

export interface UpdateOrderStatusPayload {
  customerId: string;
  orderId: string;
  status: SelectableOrderStatus;
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
  reason?: "invalid-status" | "no-indexeddb";
}

/**
 * Local-first write for an order status change (Phase 4 §3/§9): updates
 * the local order row (if the local mirror already has one — see the
 * inline comment below for why it's fine if it doesn't yet) and inserts
 * a syncQueue item, in ONE Dexie transaction. If the browser crashes
 * between "the order looks changed locally" and "a queue item exists to
 * actually deliver that change", this transaction guarantees that state
 * is never reached — both writes commit together, or neither does.
 */
export async function enqueueOrderStatusUpdate(payload: UpdateOrderStatusPayload): Promise<EnqueueResult> {
  if (!isValidSelectableOrderStatus(payload.status)) {
    return { queued: false, reason: "invalid-status" };
  }
  if (!isOfflineDbAvailable()) {
    return { queued: false, reason: "no-indexeddb" };
  }

  const db = getOfflineDb();
  const idempotencyKey = generateIdempotencyKey();

  await db.transaction("rw", [db.orders, db.syncQueue], async () => {
    // Table.update() is a silent no-op (resolves to 0, never throws) if
    // this orderId isn't in the local mirror yet — e.g. Phase 3's
    // initial sync hasn't completed this session, or ran before this
    // order existed. That's harmless in this phase specifically: nothing
    // yet reads this local `orders` row for display (the Order Board and
    // Order Detail pages are still fully server-rendered), so the only
    // thing that actually matters — the queue item below, which is what
    // delivers the change to the server — is created unconditionally.
    await db.orders.update(payload.orderId, { status: payload.status, syncStatus: "pending" });

    const item: SyncQueueItem = {
      op: "UPDATE_ORDER_STATUS",
      payload,
      status: "pending",
      attempts: 0,
      lastError: null,
      idempotencyKey,
      createdAt: Date.now(),
    };
    await db.syncQueue.add(item);
  });

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
  reason?: "invalid-input" | "no-indexeddb";
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

  await db.transaction("rw", [db.customers, db.syncQueue], async () => {
    const existing = await db.customers.get(customerId);
    // If this customer's own row hasn't reached the local mirror yet
    // (e.g. neither Phase 3's initial sync nor a prior offline create
    // has populated it), there's no known local baseline — `now` is used
    // as a harmless placeholder; the server's own existence check
    // ("not-found") is still the authoritative guard in that case.
    const baseUpdatedAt = existing?.updatedAt ?? now;

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
    };
    await db.syncQueue.add(item);
  });

  return { queued: true, id: customerId };
}

// ── Measurement save (Phase 6) ──────────────────────────────────────────

export interface SaveMeasurementPayload {
  customerId: string;
  length: string;
  shoulder: string;
  sleeve: string;
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

  await db.transaction("rw", [db.measurements, db.syncQueue], async () => {
    const existing = await db.measurements.where("customerId").equals(customerId).first();
    const row: LocalMeasurement = {
      id: existing?.id ?? customerId,
      customerId,
      length: data.length ?? null,
      shoulder: data.shoulder ?? null,
      sleeve: data.sleeve ?? null,
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
  reason?: "invalid-input" | "no-indexeddb";
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

  const REQUIRED = ["orderDate", "suitType", "collarType", "bainType", "cuffType", "gheraType", "totalAmount", "advanceAmount"];
  for (const key of REQUIRED) {
    if (!fields[key] || fields[key].trim() === "") {
      return { queued: false, reason: "invalid-input", message: `${key} is required` };
    }
  }
  if (!MONEY_REGEX.test(fields.totalAmount) || !MONEY_REGEX.test(fields.advanceAmount)) {
    return { queued: false, reason: "invalid-input", message: "Total and Advance Amount must be valid non-negative numbers" };
  }

  const db = getOfflineDb();
  const id = crypto.randomUUID();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();
  const balanceAmount = calculateBalance(fields.totalAmount, fields.advanceAmount);

  await db.transaction("rw", [db.orders, db.syncQueue], async () => {
    const row: LocalOrder = {
      id,
      orderNumber: null, // never guessed locally — server-assigned only (Phase 6 §B)
      customerId,
      orderDate: new Date(fields.orderDate).toISOString(),
      deliveryDate: fields.deliveryDate ? new Date(fields.deliveryDate).toISOString() : null,
      suitType: fields.suitType as SuitType,
      collarType: fields.collarType as CollarType,
      bainType: fields.bainType as BainType,
      cuffType: fields.cuffType as CuffType,
      gheraType: fields.gheraType as GheraType,
      pocketOptionId: fields.pocketOptionId || null,
      pattiOptionId: fields.pattiOptionId || null,
      defaultMeasurementSnapshotId: null,
      totalAmount: fields.totalAmount,
      advanceAmount: fields.advanceAmount,
      balanceAmount,
      status: "NEW",
      createdById: null, // stamped server-side from the session at sync time
      note: fields.note || null,
      createdAt: now,
      updatedAt: now,
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

  const REQUIRED = ["orderDate", "suitType", "collarType", "bainType", "cuffType", "gheraType", "totalAmount", "advanceAmount"];
  for (const key of REQUIRED) {
    if (!fields[key] || fields[key].trim() === "") {
      return { queued: false, reason: "invalid-input", message: `${key} is required` };
    }
  }
  if (!MONEY_REGEX.test(fields.totalAmount) || !MONEY_REGEX.test(fields.advanceAmount)) {
    return { queued: false, reason: "invalid-input", message: "Total and Advance Amount must be valid non-negative numbers" };
  }
  const quantity = Math.max(1, Math.min(20, parseInt(fields.quantity, 10) || 1));

  const db = getOfflineDb();
  const idempotencyKey = generateIdempotencyKey();
  const now = new Date().toISOString();
  const balanceAmount = calculateBalance(fields.totalAmount, fields.advanceAmount);

  await db.transaction("rw", [db.orders, db.orderItems, db.syncQueue], async () => {
    const existingOrder = await db.orders.get(orderId);
    // Same "no known local baseline" fallback UpdateCustomerPayload
    // already uses — the server's own existence/version checks remain
    // the authoritative guard regardless.
    const baseUpdatedAt = existingOrder?.updatedAt ?? now;

    // Table.update() is a silent no-op if this order isn't in the local
    // mirror yet (e.g. opened for edit without ever having synced down)
    // — harmless here for the same reason enqueueOrderStatusUpdate's own
    // comment explains: the queue item below is what actually delivers
    // the change, and nothing currently renders order specifics from
    // this local row alone.
    await db.orders.update(orderId, {
      deliveryDate: fields.deliveryDate ? new Date(fields.deliveryDate).toISOString() : null,
      suitType: fields.suitType as SuitType,
      collarType: fields.collarType as CollarType,
      bainType: fields.bainType as BainType,
      cuffType: fields.cuffType as CuffType,
      gheraType: fields.gheraType as GheraType,
      pocketOptionId: fields.pocketOptionId || null,
      pattiOptionId: fields.pattiOptionId || null,
      totalAmount: fields.totalAmount,
      advanceAmount: fields.advanceAmount,
      balanceAmount,
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
            suitType: fields[`item.${position}.suitType`] as SuitType,
            collarType: fields[`item.${position}.collarType`] as CollarType,
            bainType: fields[`item.${position}.bainType`] as BainType,
            cuffType: fields[`item.${position}.cuffType`] as CuffType,
            gheraType: fields[`item.${position}.gheraType`] as GheraType,
            pocketOptionId: fields[`item.${position}.pocketOptionId`] || null,
          }
        : { suitType: null, collarType: null, bainType: null, cuffType: null, gheraType: null, pocketOptionId: null };
      const row: LocalOrderItem = {
        id: existingItem?.id ?? crypto.randomUUID(),
        orderId,
        position,
        // Never guessed locally — only a real sync ever assigns/changes
        // this, same convention as orderNumber/customerCode.
        measurementSnapshotId: existingItem?.measurementSnapshotId ?? null,
        ...styleFields,
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
    };
    await db.syncQueue.add(item);
  });

  return { queued: true, id: orderId };
}

// ── Order deletion (Step 55) ────────────────────────────────────────────

export interface DeleteOrderPayload {
  orderId: string;
  customerId: string;
}

export interface OrderDeleteEnqueueResult {
  queued: boolean;
  reason?: "no-indexeddb";
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

  await db.transaction("rw", [db.orders, db.orderItems, db.syncQueue], async () => {
    await db.orders.delete(orderId);
    await db.orderItems.where("orderId").equals(orderId).delete();

    const payload: DeleteOrderPayload = { orderId, customerId };
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
      await db.syncQueue.update(item.id, { status: "sending" });

      const outcome = await sendQueueItem(item);

      if (outcome.kind === "success") {
        await db.syncQueue.update(item.id, { status: "synced", lastError: null });
        if (item.op === "UPDATE_ORDER_STATUS") {
          const payload = item.payload as UpdateOrderStatusPayload;
          // Best-effort — see the same "may not exist locally yet" note
          // in enqueueOrderStatusUpdate() above.
          await db.orders.update(payload.orderId, { syncStatus: "synced" }).catch(() => {});
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
          await db.customers
            .update(payload.customerId, { syncStatus: "synced", ...(data?.updatedAt ? { updatedAt: data.updatedAt } : {}) })
            .catch(() => {});
        } else if (item.op === "SAVE_MEASUREMENT") {
          const payload = item.payload as SaveMeasurementPayload;
          const data = outcome.data as { updatedAt?: string } | undefined;
          await db.measurements
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
              ...(data?.updatedAt ? { updatedAt: data.updatedAt } : {}),
            })
            .catch(() => {});
        } else if (item.op === "UPDATE_ORDER") {
          const payload = item.payload as UpdateOrderPayload;
          const data = outcome.data as { updatedAt?: string } | undefined;
          await db.orders
            .update(payload.orderId, { syncStatus: "synced", ...(data?.updatedAt ? { updatedAt: data.updatedAt } : {}) })
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
        // Never silently overwritten — the queue item is preserved as
        // "failed" (not deleted, not silently retried forever) and the
        // local row is flagged with the existing "conflict" syncStatus
        // (Phase 2's SyncStatus type already reserves this value) so a
        // future phase can build real conflict-resolution UI against it.
        // No such UI is implemented in this phase.
        await db.syncQueue.update(item.id, { status: "failed", attempts: item.attempts + 1, lastError: outcome.message });
        if (item.op === "UPDATE_CUSTOMER") {
          const payload = item.payload as UpdateCustomerPayload;
          await db.customers.update(payload.customerId, { syncStatus: "conflict" }).catch(() => {});
        } else if (item.op === "UPDATE_ORDER") {
          const payload = item.payload as UpdateOrderPayload;
          await db.orders.update(payload.orderId, { syncStatus: "conflict" }).catch(() => {});
        }
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
export async function retryFailedQueueItems(): Promise<RetryResult> {
  if (!isOfflineDbAvailable()) return { retriedCount: 0 };
  const db = getOfflineDb();
  const failed = await db.syncQueue.where("status").equals("failed").toArray();
  for (const item of failed) {
    if (item.id !== undefined) {
      await db.syncQueue.update(item.id, { status: "pending", attempts: 0 });
    }
  }
  return { retriedCount: failed.length };
}

type SendOutcome =
  | { kind: "success"; data?: unknown }
  | { kind: "auth-required" }
  | { kind: "conflict"; message: string }
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
      return { url: "/api/sync/order-update", body };
    }
    case "DELETE_ORDER": {
      const payload = item.payload as DeleteOrderPayload;
      return { url: "/api/sync/order-delete", body: { customerId: payload.customerId, orderId: payload.orderId } };
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
    return { kind: "conflict", message: (body && body.error) || "Conflict: this record was changed elsewhere" };
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
