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
export type DesignOptionCategory = "POCKET" | "PATTI";

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
  syncStatus: SyncStatus;
}

export interface LocalMeasurement {
  id: string;
  customerId: string; // strictly one-to-one with LocalCustomer, same rule as the server's @unique
  length: string | null; // decimal fields kept as strings — never floating-point, matching
  shoulder: string | null; // the server's Decimal(6,2) columns and this app's existing
  sleeve: string | null; // "never do float math on a measurement/money value" rule
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

export interface LocalMeasurementSnapshot {
  id: string;
  length: string | null;
  shoulder: string | null;
  sleeve: string | null;
  neck: string | null;
  chest: string | null;
  waist: string | null;
  hem: string | null;
  shalwarLength: string | null;
  pancha: string | null;
  shalwarPocket: boolean | null;
  shalwarGheraReady: string | null;
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
  suitType: SuitType;
  collarType: CollarType;
  bainType: BainType;
  cuffType: CuffType;
  gheraType: GheraType;
  pocketOptionId: string | null;
  pattiOptionId: string | null;
  defaultMeasurementSnapshotId: string | null;
  // Kept as strings, same reasoning as the measurement decimals above —
  // and the same rule this app already enforces server-side (money.ts):
  // balanceAmount is always derived, never trusted as direct input.
  totalAmount: string;
  advanceAmount: string;
  balanceAmount: string;
  status: OrderStatus;
  createdById: string | null;
  note: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  syncStatus: SyncStatus;
}

export interface LocalOrderItem {
  id: string;
  orderId: string;
  position: number;
  measurementSnapshotId: string | null;
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
  | "CREATE_ORDER"
  | "UPDATE_ORDER_STATUS";

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
   * Optional — which of this item's own payload fields are ids that
   * still belong to another not-yet-synced queue item (e.g. an order's
   * customerId when the customer itself hasn't synced yet). Part of the
   * already-approved Phase 1 design (§6); included now as a field only —
   * no processor reads or writes it yet in this phase.
   */
  localRefs?: { field: string; refType: "customer" | "order" }[];
}

// ── Sync bookkeeping (no server equivalent) ────────────────────────────

export interface SyncMetaItem {
  key: "lastPulledAt" | "deviceId" | string;
  value: unknown;
}
