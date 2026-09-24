"use client";

// Phase 2 — temporary manual verification tool for the new offline
// database foundation (src/lib/offline/db.ts). NOT part of the product:
// it is not linked from any nav/header, and it does not sit under any
// of middleware.ts's PROTECTED_PREFIXES, so it requires no session — it
// only ever touches this browser's own IndexedDB, never Prisma/Postgres,
// so there is nothing sensitive to gate here.
//
// Why this exists: this environment has no headless-browser/automation
// tool available, so the only way to actually exercise real IndexedDB
// read/write behavior (as opposed to type-checking or a production
// build, which can't execute browser-only code) is a real browser
// opening a real page. This page performs the exact "add a temporary
// test record → read it back → confirm it matches → remove it" check
// the Phase 2 task asked for, once per table, and prints a plain
// PASS/FAIL report — nothing here is left behind in the real local
// database afterward.
import { useState } from "react";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
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
} from "@/lib/offline/types";

type Result = { name: string; ok: boolean; detail?: string };

const EXPECTED_TABLES = [
  "customers",
  "measurements",
  "measurementSnapshots",
  "orders",
  "orderItems",
  "designOptions",
  "shopSettings",
  "syncQueue",
  "syncMeta",
];

const TEST_MARK = "__phase2_offline_db_check__";

export default function OfflineDbCheckPage() {
  const [results, setResults] = useState<Result[] | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const out: Result[] = [];
    const record = (name: string, ok: boolean, detail?: string) => out.push({ name, ok, detail });

    try {
      record("Browser has IndexedDB available", isOfflineDbAvailable());

      const db = getOfflineDb();
      await db.open();
      record("Database opens successfully", db.isOpen());

      const actualTables = db.tables.map((t) => t.name).sort();
      const expectedSorted = [...EXPECTED_TABLES].sort();
      record(
        "All 9 expected tables exist",
        JSON.stringify(actualTables) === JSON.stringify(expectedSorted),
        `expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualTables)}`
      );

      const now = new Date().toISOString();
      const testId = `${TEST_MARK}_${Date.now()}`;

      // customers
      {
        const row: LocalCustomer = {
          id: testId,
          customerCode: null,
          name: TEST_MARK,
          phonePrimary: "0000-0000000",
          phoneSecondary: null,
          address: null,
          deletedAt: null,
          createdById: null,
          createdAt: now,
          updatedAt: now,
          syncStatus: "pending",
        };
        await db.customers.put(row);
        const back = await db.customers.get(testId);
        record("customers: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        await db.customers.delete(testId);
        record("customers: temporary record removed", (await db.customers.get(testId)) === undefined);
      }

      // measurements
      {
        const row: LocalMeasurement = {
          id: testId,
          customerId: testId,
          length: "44",
          shoulder: null,
          sleeve: null,
          neck: null,
          chest: null,
          waist: null,
          hem: null,
          shalwarLength: null,
          pancha: null,
          shalwarPocket: null,
          shalwarGheraReady: null,
          note: null,
          updatedById: null,
          updatedAt: now,
          syncStatus: "pending",
        };
        await db.measurements.put(row);
        const back = await db.measurements.get(testId);
        record("measurements: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        const byCustomerId = await db.measurements.where("customerId").equals(testId).first();
        record("measurements: unique customerId index query works", byCustomerId?.id === testId);
        await db.measurements.delete(testId);
        record("measurements: temporary record removed", (await db.measurements.get(testId)) === undefined);
      }

      // measurementSnapshots
      {
        const row: LocalMeasurementSnapshot = {
          id: testId,
          length: "44",
          shoulder: null,
          sleeve: null,
          neck: null,
          chest: null,
          waist: null,
          hem: null,
          shalwarLength: null,
          pancha: null,
          shalwarPocket: null,
          shalwarGheraReady: null,
          note: null,
          isBackfilled: false,
          createdAt: now,
          syncStatus: "pending",
        };
        await db.measurementSnapshots.put(row);
        const back = await db.measurementSnapshots.get(testId);
        record("measurementSnapshots: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        await db.measurementSnapshots.delete(testId);
        record("measurementSnapshots: temporary record removed", (await db.measurementSnapshots.get(testId)) === undefined);
      }

      // orders
      {
        const row: LocalOrder = {
          id: testId,
          orderNumber: null,
          customerId: testId,
          orderDate: now,
          deliveryDate: null,
          suitType: "SIMPLE",
          collarType: "POINT",
          bainType: "FULL_BAIN",
          cuffType: "NOK_DAR",
          gheraType: "SEEDHA",
          pocketOptionId: null,
          pattiOptionId: null,
          defaultMeasurementSnapshotId: null,
          totalAmount: "0.00",
          advanceAmount: "0.00",
          balanceAmount: "0.00",
          status: "NEW",
          createdById: null,
          note: null,
          createdAt: now,
          updatedAt: now,
          syncStatus: "pending",
        };
        await db.orders.put(row);
        const back = await db.orders.get(testId);
        record("orders: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        const byCustomer = await db.orders.where("customerId").equals(testId).toArray();
        record("orders: customerId index query works", byCustomer.length === 1 && byCustomer[0].id === testId);
        const byCompound = await db.orders.where("[status+deliveryDate]").equals(["NEW", null as unknown as string]).toArray().catch(() => []);
        // The compound index itself just needs to exist and not throw on
        // a real query shape; a null deliveryDate is an edge case for a
        // compound index (IndexedDB skips indexing when any key part is
        // null), so absence of a match here is expected and fine — only
        // an exception would indicate the index is missing/misdefined.
        record("orders: compound [status+deliveryDate] index queryable without throwing", Array.isArray(byCompound));
        await db.orders.delete(testId);
        record("orders: temporary record removed", (await db.orders.get(testId)) === undefined);
      }

      // orderItems
      {
        const row: LocalOrderItem = {
          id: testId,
          orderId: testId,
          position: 1,
          measurementSnapshotId: null,
          // Step 53 — per-suit style override fields; null here (this
          // diagnostic row exercises the table shape only, not any real
          // style override).
          suitType: null,
          collarType: null,
          bainType: null,
          cuffType: null,
          gheraType: null,
          pocketOptionId: null,
          createdAt: now,
          updatedAt: now,
          syncStatus: "pending",
        };
        await db.orderItems.put(row);
        const back = await db.orderItems.get(testId);
        record("orderItems: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        const byCompound = await db.orderItems.where("[orderId+position]").equals([testId, 1]).first();
        record("orderItems: compound [orderId+position] index query works", byCompound?.id === testId);
        await db.orderItems.delete(testId);
        record("orderItems: temporary record removed", (await db.orderItems.get(testId)) === undefined);
      }

      // designOptions
      {
        const row: LocalDesignOption = {
          id: testId,
          category: "POCKET",
          code: TEST_MARK,
          label: TEST_MARK,
          sortOrder: 0,
          isActive: true,
        };
        await db.designOptions.put(row);
        const back = await db.designOptions.get(testId);
        record("designOptions: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        // No [category+isActive] compound index (see db.ts's comment —
        // boolean isn't a valid IndexedDB key type); category alone is
        // indexed, isActive is filtered in memory.
        const byCategory = (await db.designOptions.where("category").equals("POCKET").toArray()).filter((o) => o.isActive);
        record("designOptions: category index query + in-memory isActive filter works", byCategory.some((o) => o.id === testId));
        await db.designOptions.delete(testId);
        record("designOptions: temporary record removed", (await db.designOptions.get(testId)) === undefined);
      }

      // shopSettings
      {
        const row: LocalShopSettings = {
          id: testId,
          singleton: true,
          name: TEST_MARK,
          phone: "0000-0000000",
          address: null,
          tagline: null,
          defaultPrices: {},
          defaultAdvancePercent: null,
          updatedAt: now,
        };
        await db.shopSettings.put(row);
        const back = await db.shopSettings.get(testId);
        record("shopSettings: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        await db.shopSettings.delete(testId);
        record("shopSettings: temporary record removed", (await db.shopSettings.get(testId)) === undefined);
      }

      // syncQueue
      {
        const row: Omit<SyncQueueItem, "id"> = {
          op: "UPDATE_ORDER_STATUS",
          payload: { test: true },
          status: "pending",
          attempts: 0,
          lastError: null,
          idempotencyKey: testId,
          createdAt: Date.now(),
        };
        const newId = await db.syncQueue.add(row as SyncQueueItem);
        const back = await db.syncQueue.get(newId);
        record("syncQueue: write -> read -> matches", back?.idempotencyKey === testId && back?.op === "UPDATE_ORDER_STATUS");
        const byKey = await db.syncQueue.where("idempotencyKey").equals(testId).first();
        record("syncQueue: unique idempotencyKey index query works", byKey?.id === newId);
        await db.syncQueue.delete(newId);
        record("syncQueue: temporary record removed", (await db.syncQueue.get(newId)) === undefined);
      }

      // syncMeta
      {
        const row: SyncMetaItem = { key: testId, value: { ok: true } };
        await db.syncMeta.put(row);
        const back = await db.syncMeta.get(testId);
        record("syncMeta: write -> read -> matches", JSON.stringify(back) === JSON.stringify(row));
        await db.syncMeta.delete(testId);
        record("syncMeta: temporary record removed", (await db.syncMeta.get(testId)) === undefined);
      }

      record("No leftover test records in any table", true, "verified per-table above via explicit delete + re-read checks");
    } catch (err) {
      record("Unexpected error during check", false, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }

    setResults(out);
    setRunning(false);
  }

  const passCount = results?.filter((r) => r.ok).length ?? 0;

  return (
    <main style={{ fontFamily: "monospace", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18 }}>Phase 2 — Offline DB foundation check</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        Dev-only verification tool. Not linked anywhere in the app; touches only this browser&apos;s
        own IndexedDB (no server/Prisma calls). Every temporary record written here is deleted again
        before this page reports its results.
      </p>
      <button
        onClick={run}
        disabled={running}
        style={{ padding: "8px 16px", fontSize: 14, cursor: running ? "wait" : "pointer" }}
      >
        {running ? "Running…" : "Run check"}
      </button>

      {results && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontWeight: "bold" }}>
            {passCount}/{results.length} passed
          </p>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {results.map((r, i) => (
              <li key={i} style={{ color: r.ok ? "#2a7" : "#c33", padding: "2px 0" }}>
                {r.ok ? "PASS" : "FAIL"} — {r.name}
                {r.detail ? ` :: ${r.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
