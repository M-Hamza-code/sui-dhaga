// Phase 2 — Offline-First Local Database Foundation.
//
// The browser-side Dexie/IndexedDB database. This is infrastructure
// only: nothing in the existing application reads from or writes to
// this yet (see the Phase 2 task's explicit "do not connect the app to
// Dexie yet" rule). No Server Action, Server Component, Prisma call, or
// existing page is touched by this file's existence.
//
// Imports NOTHING from "@prisma/client", "@/lib/prisma", or any other
// server-only module — see ./types.ts's own comment for why even a
// type-only Prisma import was deliberately avoided here. This file is
// safe to import from a Client Component; it must never be imported
// from a Server Component or Server Action (see getOfflineDb() below).
import Dexie, { type Table } from "dexie";
import type {
  LocalCustomer,
  LocalMeasurement,
  LocalMeasurementSnapshot,
  LocalOrder,
  LocalOrderItem,
  LocalDesignOption,
  LocalShopSettings,
  SyncQueueItem,
  SyncMetaItem,
} from "./types";

const DATABASE_NAME = "sui-dhaga-offline";

class SuiDhagaOfflineDatabase extends Dexie {
  customers!: Table<LocalCustomer, string>;
  measurements!: Table<LocalMeasurement, string>;
  measurementSnapshots!: Table<LocalMeasurementSnapshot, string>;
  orders!: Table<LocalOrder, string>;
  orderItems!: Table<LocalOrderItem, string>;
  designOptions!: Table<LocalDesignOption, string>;
  shopSettings!: Table<LocalShopSettings, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  syncMeta!: Table<SyncMetaItem, string>;

  constructor() {
    super(DATABASE_NAME);

    // Version 1 — the initial foundation schema (this Phase 2 step).
    // Dexie's own migration convention: a future schema change adds a
    // NEW `this.version(2).stores({...}).upgrade(tx => ...)` block below
    // this one. This version 1 block must never be edited in place once
    // it has shipped to a real browser — a returning browser with
    // existing local data needs an explicit upgrade path, not a silently
    // redefined schema.
    //
    // Dexie's store-definition string lists ONLY indexed fields —
    // IndexedDB is schemaless per record, so every field declared on the
    // TypeScript interfaces in ./types.ts is stored regardless of
    // whether it appears here. The first entry is the primary key; a
    // leading `&` marks a unique index; `[a+b]` marks a compound index.
    // Indexes below mirror this project's own prisma/schema.prisma
    // @@index/@@unique declarations wherever there's a direct
    // equivalent, so the same queries this app already relies on
    // server-side stay cheap locally once later phases actually query
    // this database.
    this.version(1).stores({
      // Mirrors Customer's own @@index([phonePrimary]) / @@index([name])
      // / @@index([deletedAt]). customerCode is indexed but deliberately
      // NOT unique (`&`) — a locally-created, not-yet-synced customer has
      // customerCode: null, and more than one such row existing at once
      // must never throw a uniqueness error. Postgres remains the sole
      // enforcer of real customerCode uniqueness, exactly as today.
      customers: "id, customerCode, name, phonePrimary, deletedAt, syncStatus",

      // customerId is the real 1:1 key, matching Measurement.customerId
      // @unique server-side — id stays the primary key for consistency
      // with every other table, customerId is a unique secondary index.
      measurements: "id, &customerId, syncStatus",

      // No customer/order FK lives on this model server-side either —
      // it's only reachable via Order/OrderItem (see schema.prisma's own
      // comment on MeasurementSnapshot). createdAt indexed for recency.
      measurementSnapshots: "id, createdAt, syncStatus",

      // customerId + the compound [status+deliveryDate] index mirrors
      // Order's own @@index([customerId]) / @@index([status, deliveryDate])
      // exactly. orderNumber is indexed, not unique, for the same
      // null-before-sync reason as customerCode above.
      orders: "id, customerId, orderNumber, status, deliveryDate, [status+deliveryDate], syncStatus",

      // orderId + the compound [orderId+position] mirrors OrderItem's own
      // @@unique([orderId, position]) — kept as a plain (non-unique)
      // compound index locally for the same reason as orderNumber above.
      orderItems: "id, orderId, [orderId+position], syncStatus",

      // Read-only reference cache. Mirrors DesignOption's own
      // @@index([category, isActive]) only partially: IndexedDB key
      // paths must be a valid IndexedDB key type (string, number, Date,
      // or an Array of those) — a boolean is NOT a valid key type, so
      // `isActive` cannot itself be part of an index here (unlike
      // Postgres, which has no such restriction). `category` alone is
      // indexed; a future query for "active options in this category"
      // filters `isActive` in memory afterward, which is negligible cost
      // for a handful of design-option rows. Never locally
      // created/edited (approved Phase 1 architecture, §3/§7), so no
      // syncStatus field on this table.
      designOptions: "id, category",

      // Read-only single-row cache — `singleton` mirrors the server's
      // own unique boolean flag. Never offline-writable (Correction 7).
      shopSettings: "id, &singleton",

      // Local-only — no server equivalent. Auto-incrementing key (++id)
      // since this is a pure local log, not a record that's itself ever
      // synced. idempotencyKey is indexed uniquely so the same operation
      // can never be enqueued twice by accident.
      syncQueue: "++id, status, op, createdAt, &idempotencyKey",

      // Local-only key/value bag.
      syncMeta: "key",
    });

    // Future phases: add
    //   this.version(2).stores({ ... }).upgrade(tx => { ... });
    // here. Never edit the version(1) block above once it has shipped.
  }
}

// ── SSR / browser safety ────────────────────────────────────────────────
// This is a Next.js 14 App Router project — most of the codebase renders
// as Server Components, in Node, where `window`/`indexedDB` don't exist
// at all. Dexie resolves the ambient IndexedDB implementation as soon as
// an instance is constructed, so the instance must never be created
// outside a real browser. Nothing in this file constructs it at
// module-evaluation time — that only happens lazily, inside
// getOfflineDb(), the first time a browser-side caller actually asks for
// the database. An accidental Server Component import of this module
// still only pulls in the (inert) class definition above; it does not by
// itself touch indexedDB, throw, or break a build.
let instance: SuiDhagaOfflineDatabase | null = null;

/** True only when running in a real browser with IndexedDB available. */
export function isOfflineDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/**
 * Returns the single shared offline database instance, creating it on
 * first call. Throws a clear, specific error if called outside a
 * browser (e.g. accidentally from a Server Component) — this is a
 * programmer-error guard, not a condition any real user should ever hit,
 * so a loud, immediate, descriptive error here is preferable to a
 * cryptic "indexedDB is not defined" surfacing from deep inside Dexie.
 */
export function getOfflineDb(): SuiDhagaOfflineDatabase {
  if (!isOfflineDbAvailable()) {
    throw new Error(
      "getOfflineDb() was called outside a browser environment (no window/indexedDB available). " +
        "The offline database is browser-only — never import or call this from a Server " +
        "Component, Server Action, middleware, or any other server-side code path."
    );
  }
  if (!instance) {
    instance = new SuiDhagaOfflineDatabase();
  }
  return instance;
}

export type { SuiDhagaOfflineDatabase };
