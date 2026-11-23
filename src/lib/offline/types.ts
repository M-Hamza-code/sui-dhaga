// Phase 2 — Offline-First Local Database Foundation.
//
// Plain TypeScript types for every local (Dexie/IndexedDB) table row.
// Deliberately import NOTHING from "@prisma/client" — not even a
// type-only import of its generated enums — even though a type-only
// import is erased at compile time and would be technically safe (this
// exact pattern already exists elsewhere in the app: order-options.ts
// does `import type { SuitType, ... } from "@prisma/client"` and is
// imported by a client component today). This module chooses the more
// conservative route anyway: the five style enums below are small,
// fixed, rarely-changing string sets, so they're just re-declared here
// as local literal unions. That keeps this file — and everything that
// imports it — fully independent of the `@prisma/client` package
// existing in the bundle at all, which is the safest possible reading
// of "do not import Prisma Client... into the browser-side Dexie
// database module."
//
// Field names below are taken directly from prisma/schema.prisma —
// nothing here is guessed or invented. Where a local row needs
// something the server model doesn't have (an offline bookkeeping
// field), that field is clearly separated and commented as such.

// ── Mirrors of prisma/schema.prisma's enums (values only, verified
//    against the schema; see schema.prisma for the source of truth) ──
export type SuitType = "SIMPLE" | "GARAM_SILAI" | "DESIGNING" | "DOUBLE_STITCH" | "BARABAR_SILAI";
export type CollarType = "POINT" | "FRENCH" | "TIE";
export type BainType = "FULL_BAIN" | "HALF_GOL_BAIN" | "CUT_BAIN";
export type CuffType = "NOK_DAR" | "CUT" | "GOL" | "FOLD";
export type GheraType = "GOL" | "SEEDHA";
export type OrderStatus = "PENDING" | "NEW" | "STITCHING" | "READY" | "DELIVERED";
export type DesignOptionCategory = "POCKET" | "PATTI" | "PANCHA";
export type MeasurementMode = "KAMEEZ_SHALWAR" | "COAT";
export type CoatGarmentSelection = "PRINCE_COAT" | "WAISTCOAT" | "BOTH";

// ── Offline bookkeeping, not present on any server model ──────────────
/** Per-record sync state for anything that can be created/edited offline. */
export type SyncStatus = "synced" | "pending" | "conflict";

// ── Local table row shapes ─────────────────────────────────────────────
// Each mirrors its Prisma model's own fields (see prisma/schema.prisma),
// plus `syncStatus` where the record can originate offline. Sequential,
// server-only codes (customerCode/orderNumber) are always `string | null`
// locally — null until a real sync assigns one; never guessed client-side
// (Phase 1 §4/§5 of the approved architecture).

export interface LocalCustomer {
  id: string; // permanent — client-generated (crypto.randomUUID()) or server cuid once pulled down
  customerCode: string | null; // null until server-assigned
  name: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  address: string | null;
  deletedAt: string | null; // ISO string (IndexedDB structured-clone handles Date fine too, but a
  // plain ISO string keeps this file free of any Date-serialization
  // subtlety across tab reloads/versions — deliberately simple)
  createdById: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /**
   * The server's last CONFIRMED `updatedAt` for this record — distinct
   * from `updatedAt` above, which bumps on every local edit before any
   * sync. Only ever advances via (a) an initial-sync pull of a `"synced"`
   * row, or (b) this device's own successful sync of an update to this
   * record. This is what an UPDATE_CUSTOMER queue item's dispatch
   * freezes as its concurrency token (see sync-engine.ts's
   * prepareItemForDispatch) — never the mutable `updatedAt`, which would
   * cause false conflicts for sequential offline edits made before the
   * first one has synced. `null` only for a locally-created, not-yet-
   * synced row (nothing confirmed by the server yet).
   */
  baseUpdatedAt: string | null;
  syncStatus: SyncStatus;
}

export interface LocalMeasurement {
  id: string;
  customerId: string; // strictly one-to-one with LocalCustomer, same rule as the server's @unique
  length: string | null; // decimal fields kept as strings — never floating-point, matching
  shoulder: string | null; // the server's Decimal(6,2) columns and this app's existing
  sleeve: string | null; // "never do float math on a measurement/money value" rule
  armHole: string | null;
  kohni: string | null;
  neck: string | null;
  chest: string | null;
  waist: string | null;
  hem: string | null;
  shalwarLength: string | null;
  pancha: string | null;
  shalwarPocket: boolean | null;
  shalwarGheraReady: string | null;
  note: string | null;
  updatedById: string | null;
  updatedAt: string; // ISO
  syncStatus: SyncStatus;
}

export interface LocalCoatMeasurement {
  id: string;
  customerId: string; // strictly one-to-one with LocalCustomer, same rule as the server's @unique
  coatLength: string | null;
  coatShoulder: string | null;
  coatChest: string | null;
  coatWaist: string | null;
  coatHipSeat: string | null;
  coatSleeve: string | null;
  coatArmHole: string | null;
  coatBicep: string | null;
  coatCuff: string | null;
  coatNeck: string | null;
  coatBackWidth: string | null;
  coatFrontLength: string | null;
  waistcoatLength: string | null;
  waistcoatShoulder: string | null;
  waistcoatChest: string | null;
  waistcoatWaist: string | null;
  waistcoatHipSeat: string | null;
  waistcoatArmHole: string | null;
  waistcoatNeck: string | null;
  waistcoatBackWidth: string | null;
  waistcoatFrontLength: string | null;
  note: string | null;
  updatedById: string | null;
  updatedAt: string; // ISO
  syncStatus: SyncStatus;
}

export interface LocalMeasurementSnapshot {
  id: string;
  length: string | null;
  shoulder: string | null;
  sleeve: string | null;
  armHole: string | null;
  kohni: string | null;
  neck: string | null;
  chest: string | null;
  waist: string | null;
  hem: string | null;
  shalwarLength: string | null;
  pancha: string | null;
  shalwarPocket: boolean | null;
  shalwarGheraReady: string | null;
  // Prince Coat + Waistcoat — mirrors CoatMeasurement's own fields; see
  // that model's schema.prisma comment for why the two groups never share
  // a column and are never both populated on the same row.
  coatLength: string | null;
  coatShoulder: string | null;
  coatChest: string | null;
  coatWaist: string | null;
  coatHipSeat: string | null;
  coatSleeve: string | null;
  coatArmHole: string | null;
  coatBicep: string | null;
  coatCuff: string | null;
  coatNeck: string | null;
  coatBackWidth: string | null;
  coatFrontLength: string | null;
  waistcoatLength: string | null;
  waistcoatShoulder: string | null;
  waistcoatChest: string | null;
  waistcoatWaist: string | null;
  waistcoatHipSeat: string | null;
  waistcoatArmHole: string | null;
  waistcoatNeck: string | null;
  waistcoatBackWidth: string | null;
  waistcoatFrontLength: string | null;
  note: string | null;
  isBackfilled: boolean;
  createdAt: string; // ISO — immutable once written, exactly like the server model
  syncStatus: SyncStatus;
}

export interface LocalOrder {
  id: string;
  orderNumber: string | null; // null until server-assigned — never guessed locally
  customerId: string;
  orderDate: string; // ISO
  deliveryDate: string | null; // ISO
  /** Which measurement form this order's default block used — see MeasurementMode's own schema.prisma comment. */
  measurementMode: MeasurementMode;
  // Upgrade — all three nullable now: each can be deliberately "Not
  // Specified", and a Coat-mode order has none of the five Suit & Styles
  // fields set at all.
  suitType: SuitType | null;
  // Step 63 — combined single choice: exactly one of these two is ever
  // non-null, never both, never neither (see order-actions.ts's own
  // comment on the same rule server-side).
  collarType: CollarType | null;
  bainType: BainType | null;
  cuffType: CuffType | null;
  gheraType: GheraType | null;
  pocketOptionId: string | null;
  pattiOptionId: string | null;
  panchaOptionId: string | null;
  defaultMeasurementSnapshotId: string | null;
  // Kept as strings, same reasoning as the measurement decimals above —
  // and the same rule this app already enforces server-side (money.ts):
  // balanceAmount is always derived, never trusted as direct input.
  totalAmount: string;
  advanceAmount: string;
  balanceAmount: string;
  /** The actual Prince Coat/Waistcoat per-unit price frozen for this order — see Order.princeCoatUnitPrice's own schema.prisma comment. Null when this order has no Coat/Waistcoat entries. */
  princeCoatUnitPrice: string | null;
  waistcoatUnitPrice: string | null;
  status: OrderStatus;
  createdById: string | null;
  note: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /** The server's last CONFIRMED `updatedAt` for this order — see LocalCustomer.baseUpdatedAt's own comment for the full reasoning; same rule, same rename-free addition, applies here. */
  baseUpdatedAt: string | null;
  syncStatus: SyncStatus;
}

export interface LocalOrderItem {
  id: string;
  orderId: string;
  position: number;
  measurementSnapshotId: string | null;
  // Step 53 — mirrors the Step 50 per-suit style-override columns added
  // to the server's OrderItem model. All null together = "same style as
  // the order" (always true for position 1) — same convention as the
  // server. Added here (Edit Order) so a locally-edited order's per-suit
  // styles round-trip through the local mirror instead of being silently
  // dropped.
  suitType: SuitType | null;
  collarType: CollarType | null;
  bainType: BainType | null;
  cuffType: CuffType | null;
  gheraType: GheraType | null;
  pocketOptionId: string | null;
  /** "Ideally, an order should also support both garment types" — null = inherits Order.measurementMode (always true for position 1). */
  measurementMode: MeasurementMode | null;
  /** Explicit garment selection upgrade — see OrderItem.coatGarmentSelection's own schema.prisma comment. Only meaningful when this item's effective measurementMode is COAT; null for every Kameez/Shalwar item, and for any Coat item saved before this field existed (interpreted as BOTH, never re-derived from content). */
  coatGarmentSelection: CoatGarmentSelection | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  syncStatus: SyncStatus;
}

/** Read-only reference cache — never locally created/edited (Phase 1 §3/§7). */
export interface LocalDesignOption {
  id: string;
  category: DesignOptionCategory;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

/** Read-only reference cache of the single ShopSettings row — never offline-writable (Correction 7). */
export interface LocalShopSettings {
  id: string;
  singleton: true;
  name: string;
  phone: string;
  address: string | null;
  tagline: string | null;
  // Kept as the same opaque JSON shape ShopSettings.defaultPrices already
  // is server-side (see shop-settings.ts's parseDefaultPrices) — read
  // through the same kind of narrowing helper when actually consumed,
  // not trusted as pre-validated just because it came from the local cache.
  defaultPrices: unknown;
  defaultAdvancePercent: string | null;
  updatedAt: string; // ISO
}

// ── Sync queue (no server equivalent — purely local bookkeeping) ──────

export type SyncOp =
  | "CREATE_CUSTOMER"
  | "CREATE_CUSTOMER_AND_ORDER"
  | "UPDATE_CUSTOMER"
  | "SAVE_MEASUREMENT"
  | "SAVE_COAT_MEASUREMENT"
  | "CREATE_ORDER"
  | "UPDATE_ORDER_STATUS"
  // Step 53 — Edit Order (measurements/styles/quantity/payment/delivery
  // date on an already-existing order). Distinct from UPDATE_ORDER_STATUS,
  // which only ever changes `status` and stays completely untouched.
  | "UPDATE_ORDER"
  // Step 55 — Delete Order. Never deletes the Customer (Rule A) — see
  // sync-engine.ts's enqueueDeleteOrder and order-delete.ts.
  | "DELETE_ORDER";

export type SyncQueueStatus = "pending" | "sending" | "synced" | "failed";

export interface SyncQueueItem {
  /** Auto-incrementing local key — this table has no server counterpart to share an id with. */
  id?: number;
  op: SyncOp;
  /** Exactly what the matching future /api/sync/* handler will expect — shape is op-specific, not enforced further here in Phase 2. */
  payload: unknown;
  status: SyncQueueStatus;
  attempts: number;
  lastError: string | null;
  /**
   * Stable across retries (set once at enqueue time) so a later sync
   * processor can treat a retried send as "already applied" rather than
   * a duplicate — see the approved Phase 1 architecture, §6.
   */
  idempotencyKey: string;
  /** Client clock at enqueue time — the ordering key within this one device/browser. */
  createdAt: number;
  /**
   * True once this item's `payload.baseUpdatedAt` has been frozen from a
   * live read of its local record and persisted — happens exactly once,
   * at this item's first actual dispatch attempt (see sync-engine.ts's
   * prepareItemForDispatch). Every later automatic retry of the SAME
   * item reuses that frozen value unchanged rather than re-reading the
   * live record again — re-reading on every retry would let the
   * operation's own canonical payload/hash silently drift across
   * retries, which collides with UPDATE_ORDER's idempotency-receipt
   * design (same operationId, different hash, is rejected as reuse).
   * Resolving once at first dispatch (rather than at enqueue time) still
   * correctly picks up an earlier queued item's completion, since FIFO
   * processing means this item's first dispatch only happens after
   * every earlier item has already been fully resolved.
   * resolveConflictKeepLocal() sets this directly when it rebases the
   * payload onto the server's reported baseline, since it already
   * supplies an authoritative value itself.
   */
  baselineResolved?: boolean;
  /**
   * Set when this item could never be safely dispatched at all — the
   * live local baseline could not be established (the record is
   * missing) or the resolved baseline could not be persisted before
   * sending. The network is never contacted in either case. Distinct
   * from `conflictServerUpdatedAt` (that one means the SERVER rejected a
   * real attempt) and from `idempotencyKeyReuse` (that one is a
   * server-classified permanent rejection) — this one never leaves the
   * browser. Excluded from retryFailedQueueItems() for the same reason
   * conflicts are: the underlying cause won't resolve itself by blindly
   * resending.
   */
  dispatchBlocked?: boolean;
  /**
   * Set ONLY when the server rejected this item with the explicit
   * `idempotency-key-reuse` machine-readable code (HTTP 422) — this
   * operationId already has a committed receipt under a DIFFERENT
   * payload. This should never happen under correct client operation; it
   * is a permanent, manual-review failure, never a stale-version
   * conflict (so it must never set `conflictServerUpdatedAt` or appear
   * in readConflicts()/resolveConflictKeepLocal/resolveConflictUseServer)
   * and never auto- or manually-retried unchanged, since resending the
   * identical frozen payload would only ever fail the same way again.
   */
  idempotencyKeyReuse?: boolean;
  /**
   * Optional — which of this item's own payload fields are ids that
   * still belong to another not-yet-synced queue item (e.g. an order's
   * customerId when the customer itself hasn't synced yet). Part of the
   * already-approved Phase 1 design (§6); included now as a field only —
   * no processor reads or writes it yet in this phase.
   */
  localRefs?: { field: string; refType: "customer" | "order" }[];
  /**
   * Set ONLY when this item failed with a 409 conflict: the server's
   * current `updatedAt` for the record, taken straight from the conflict
   * response body (customer-sync.ts / order-update.ts both return it as
   * `serverUpdatedAt`).
   *
   * Two jobs:
   *   1. It is what makes a conflicted item distinguishable from an
   *      ordinary failure. Both sit at `status: "failed"`, so without
   *      this flag retryFailedQueueItems() could not tell them apart and
   *      would resend a conflict forever with the same stale baseline.
   *   2. Resolving "keep my version" needs exactly this value as the new
   *      baseUpdatedAt — that is what lets the server accept the edit
   *      instead of refusing it again.
   *
   * Not an indexed Dexie field, so adding it needs no schema version
   * bump: IndexedDB is schemaless per record and db.ts's store strings
   * only declare indexes.
   */
  conflictServerUpdatedAt?: string;
}

// ── Sync bookkeeping (no server equivalent) ────────────────────────────

export interface SyncMetaItem {
  key: "lastPulledAt" | "deviceId" | string;
  value: unknown;
}
