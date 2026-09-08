"use client";

// Phase 3 — temporary manual verification tool for the initial
// Server → Local sync's CLIENT-side half (writing the fetched dataset
// into Dexie). NOT part of the product: not linked from any nav/header,
// not under any of middleware.ts's PROTECTED_PREFIXES.
//
// Why this exists: the server-side half (GET /api/sync/initial) is
// fully tested via plain HTTP (see the Phase 3 test script) — no
// browser needed for that part at all. But actually writing into
// IndexedDB only happens inside a real browser's JS runtime, and this
// environment has no headless-browser/automation tool available, so
// this page exists for a human (you) to open and confirm the write
// side actually works, the same reasoning as Phase 2's
// /dev/offline-db-check page.
//
// This calls the exact same runInitialSync() the real
// InitialSyncBootstrap component calls — nothing here is a second,
// parallel implementation of the sync logic.
//
// Phase 4 additions (same reasoning): the sync QUEUE's actual delivery
// to /api/sync/order-status only happens inside a real browser too, and
// "the browser is offline" is best simulated with the browser's own
// devtools (Network tab -> Throttling -> Offline), which this page has
// no way to trigger programmatically — so the buttons below call the
// exact same enqueueOrderStatusUpdate()/processSyncQueue() the real
// OrderStatusForm uses, and you can toggle devtools' offline throttling
// around them to see both the offline-queued and reconnect-and-sync
// paths for yourself.
// Phase 6 additions (same reasoning): SAVE_MEASUREMENT and CREATE_ORDER
// only actually write to IndexedDB / deliver to their /api/sync/*
// endpoints inside a real browser too — the buttons below call the
// exact same enqueueSaveMeasurement()/enqueueCreateOrder()/
// processSyncQueue() the real MeasurementForm/OrderForm use, nothing
// duplicated. The "dependency test" button demonstrates the Phase 6
// "Important Dependency Rule" scenario end-to-end in a real browser:
// enqueue a customer AND an order for that same not-yet-synced customer
// while simulating offline (see the on-screen instructions), then
// process the queue once reconnected and see both sync in the correct
// order. The automated (non-browser) half of that same scenario is
// covered by test-phase6.mjs's own dependency test, which exercises the
// real server-side safety net (a child request against a genuinely
// unsynced parent correctly fails, then correctly succeeds once the
// parent exists) via plain HTTP — see that script for what it actually
// proves versus what only a human can confirm here.
// Phase 7 additions (same reasoning): the new sync-status summary/badge
// readers are plain Dexie reads, verifiable via plain HTTP-free unit
// tests for their PURE logic (see test-phase7.mjs), but the actual
// production <SyncStatusIndicator> (header pill), <CustomerIdentityCard>
// badge, <MeasurementSyncBadge>, and <PendingOrdersNotice> only render
// for real inside a browser. The buttons below call the exact same
// readSyncStatusSummary()/readCustomerSyncBadge()/
// readMeasurementSyncBadge()/readOrderSyncBadge() those components use
// — nothing duplicated — so you can confirm the computed state matches
// what the header pill and profile page actually show.
import { useState } from "react";
import { runInitialSync } from "@/lib/offline/initial-sync";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import {
  readSyncStatusSummary,
  readCustomerSyncBadge,
  readMeasurementSyncBadge,
  readOrderSyncBadge,
} from "@/lib/offline/sync-status";
import {
  enqueueOrderStatusUpdate,
  enqueueCreateCustomer,
  enqueueUpdateCustomer,
  enqueueSaveMeasurement,
  enqueueCreateOrder,
  processSyncQueue,
  retryFailedQueueItems,
} from "@/lib/offline/sync-engine";
// Phase 9 additions (same reasoning): retryFailedQueueItems() and
// readConsistencyIssues() are plain Dexie reads/writes, verifiable via
// plain HTTP-free unit tests for their PURE logic (see test-phase9.mjs),
// but only actually exercise real IndexedDB state inside a browser. The
// buttons below call the exact same production functions
// <SyncStatusIndicator> itself uses for "Retry failed" — nothing
// duplicated.
import { readConsistencyIssues } from "@/lib/offline/consistency-check";
// Phase 11 addition (same reasoning): searchCustomersLocally() is a
// plain Dexie read, verifiable via a plain HTTP-free unit test for its
// PURE matching rules (see test-phase11.mjs), but only actually reads
// real IndexedDB state inside a browser. This button calls the exact
// same production function useCustomerSearch() falls back to.
import { searchCustomersLocally } from "@/lib/offline/customer-search-local";

export default function SyncCheckPage() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [status, setStatus] = useState("READY");
  const [custName, setCustName] = useState("Dev Test Customer");
  const [custPhone, setCustPhone] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [editName, setEditName] = useState("");
  const [measLength, setMeasLength] = useState("44");
  const [orderTotal, setOrderTotal] = useState("5000.00");
  const [searchQuery, setSearchQuery] = useState("");

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function runSync() {
    setRunning(true);
    setLog([]);
    append(`isOfflineDbAvailable(): ${isOfflineDbAvailable()}`);
    append("Calling runInitialSync() — the exact function InitialSyncBootstrap calls on every app load…");
    const result = await runInitialSync();
    append(`Result: ${JSON.stringify(result, null, 2)}`);
    setRunning(false);
  }

  async function readLocalCounts() {
    setRunning(true);
    try {
      const db = getOfflineDb();
      await db.open();
      const [customers, measurements, orders, orderItems, measurementSnapshots, designOptions, shopSettings, syncMeta] = await Promise.all([
        db.customers.count(),
        db.measurements.count(),
        db.orders.count(),
        db.orderItems.count(),
        db.measurementSnapshots.count(),
        db.designOptions.count(),
        db.shopSettings.count(),
        db.syncMeta.get("lastPulledAt"),
      ]);
      setLog([
        "Current local (Dexie) row counts:",
        `customers: ${customers}`,
        `measurements: ${measurements}`,
        `orders: ${orders}`,
        `orderItems: ${orderItems}`,
        `measurementSnapshots: ${measurementSnapshots}`,
        `designOptions: ${designOptions}`,
        `shopSettings: ${shopSettings}`,
        `syncMeta.lastPulledAt: ${JSON.stringify(syncMeta?.value ?? null)}`,
      ]);
    } catch (err) {
      setLog([`Error reading local counts: ${err instanceof Error ? err.message : String(err)}`]);
    }
    setRunning(false);
  }

  async function inspectQueue() {
    setRunning(true);
    try {
      const db = getOfflineDb();
      await db.open();
      const items = await db.syncQueue.toArray();
      setLog([
        `syncQueue (${items.length} item${items.length === 1 ? "" : "s"}):`,
        ...items.map(
          (i) =>
            `#${i.id} op=${i.op} status=${i.status} attempts=${i.attempts} idempotencyKey=${i.idempotencyKey} lastError=${i.lastError ?? "null"} payload=${JSON.stringify(i.payload)}`
        ),
      ]);
    } catch (err) {
      setLog([`Error inspecting queue: ${err instanceof Error ? err.message : String(err)}`]);
    }
    setRunning(false);
  }

  async function enqueueChange() {
    setRunning(true);
    setLog([]);
    append(`enqueueOrderStatusUpdate({ customerId: "${customerId}", orderId: "${orderId}", status: "${status}" })`);
    append(
      "(this is exactly what OrderStatusForm calls on change — the same order/customer used on a real Order Board/Order Detail page in this browser)"
    );
    const result = await enqueueOrderStatusUpdate({ customerId, orderId, status: status as "NEW" | "STITCHING" | "READY" | "DELIVERED" });
    append(`Enqueue result: ${JSON.stringify(result)}`);
    setRunning(false);
  }

  async function runProcessor() {
    setRunning(true);
    setLog([]);
    append("Calling processSyncQueue() — the exact function SyncQueueBootstrap and OrderStatusForm both call…");
    const result = await processSyncQueue();
    append(`Result: ${JSON.stringify(result, null, 2)}`);
    setRunning(false);
  }

  async function createCustomerLocal() {
    setRunning(true);
    setLog([]);
    append(`enqueueCreateCustomer({ name: "${custName}", phonePrimary: "${custPhone}" }) — same function NewCustomerForm calls…`);
    const result = await enqueueCreateCustomer({ name: custName, phonePrimary: custPhone, phoneSecondary: "", address: "" });
    append(`Enqueue result: ${JSON.stringify(result)}`);
    if (result.id) {
      const db = getOfflineDb();
      const row = await db.customers.get(result.id);
      append(`Local customer row right after enqueue: ${JSON.stringify(row)}`);
      setEditCustomerId(result.id);
    }
    setRunning(false);
  }

  async function updateCustomerLocal() {
    setRunning(true);
    setLog([]);
    append(`enqueueUpdateCustomer("${editCustomerId}", { name: "${editName}", ... }) — same function EditCustomerForm calls…`);
    const result = await enqueueUpdateCustomer(editCustomerId, { name: editName, phonePrimary: custPhone, phoneSecondary: "", address: "" });
    append(`Enqueue result: ${JSON.stringify(result)}`);
    setRunning(false);
  }

  async function saveMeasurementLocal() {
    setRunning(true);
    setLog([]);
    append(`enqueueSaveMeasurement("${customerId}", { length: "${measLength}", ... }) — same function MeasurementForm calls…`);
    const result = await enqueueSaveMeasurement(customerId, {
      length: measLength,
      shoulder: "",
      sleeve: "",
      neck: "",
      chest: "",
      waist: "",
      hem: "",
      shalwarLength: "",
      pancha: "",
      shalwarGheraReady: "",
      shalwarPocket: "",
      note: "Dev tool test",
    });
    append(`Enqueue result: ${JSON.stringify(result)}`);
    setRunning(false);
  }

  function buildTestOrderFormData(): FormData {
    // A minimal but complete FormData matching exactly what OrderForm's
    // own `new FormData(formElement)` produces — same field names
    // validateOrderInput() reads. Quantity 1, no per-suit override.
    const fd = new FormData();
    fd.set("orderDate", new Date().toISOString().slice(0, 10));
    fd.set("suitType", "SIMPLE");
    fd.set("collarType", "POINT");
    fd.set("bainType", "FULL_BAIN");
    fd.set("cuffType", "NOK_DAR");
    fd.set("gheraType", "GOL");
    fd.set("quantity", "1");
    fd.set("totalAmount", orderTotal);
    fd.set("advanceAmount", "0");
    fd.set("default.length", "44");
    fd.set("item.1.override", "off");
    fd.set("sendOnWhatsApp", "off");
    return fd;
  }

  async function createOrderLocal() {
    setRunning(true);
    setLog([]);
    append(`enqueueCreateOrder("${customerId}", formData) — same function OrderForm calls for an existing customer…`);
    const result = await enqueueCreateOrder(customerId, buildTestOrderFormData());
    append(`Enqueue result: ${JSON.stringify(result)}`);
    if (result.id) {
      const db = getOfflineDb();
      const row = await db.orders.get(result.id);
      append(`Local order row right after enqueue: ${JSON.stringify(row)}`);
    }
    setRunning(false);
  }

  async function inspectOrdersAndMeasurements() {
    setRunning(true);
    try {
      const db = getOfflineDb();
      await db.open();
      const [orders, measurements] = await Promise.all([db.orders.toArray(), db.measurements.toArray()]);
      setLog([
        `orders (${orders.length} row${orders.length === 1 ? "" : "s"}):`,
        ...orders.map(
          (o) => `id=${o.id} customerId=${o.customerId} orderNumber=${o.orderNumber ?? "null (Pending sync…)"} syncStatus=${o.syncStatus}`
        ),
        "",
        `measurements (${measurements.length} row${measurements.length === 1 ? "" : "s"}):`,
        ...measurements.map((m) => `id=${m.id} customerId=${m.customerId} length=${m.length} syncStatus=${m.syncStatus}`),
      ]);
    } catch (err) {
      setLog([`Error inspecting orders/measurements: ${err instanceof Error ? err.message : String(err)}`]);
    }
    setRunning(false);
  }

  async function runDependencyDemo() {
    setRunning(true);
    setLog([]);
    append(
      "Dependency demo: enqueues a brand-new customer AND an order for that same (not-yet-synced) customer, " +
        "then calls processSyncQueue() ONCE. To actually exercise the offline scenario, set devtools -> " +
        "Network -> Throttling -> Offline BEFORE clicking this button, then switch back to Online and click " +
        "'Process queue' above."
    );
    const customerResult = await enqueueCreateCustomer({
      name: "Dependency Demo Customer",
      phonePrimary: `03${Date.now().toString().slice(-9)}`,
      phoneSecondary: "",
      address: "",
    });
    append(`1. enqueueCreateCustomer result: ${JSON.stringify(customerResult)}`);
    if (!customerResult.id) {
      setRunning(false);
      return;
    }
    const newCustomerId = customerResult.id;
    const orderResult = await enqueueCreateOrder(newCustomerId, buildTestOrderFormData());
    append(`2. enqueueCreateOrder (same customerId, still unsynced) result: ${JSON.stringify(orderResult)}`);
    append("3. Calling processSyncQueue() once — the customer's CREATE should sync before the order's CREATE is even attempted…");
    const processResult = await processSyncQueue();
    append(`Result: ${JSON.stringify(processResult, null, 2)}`);
    const db = getOfflineDb();
    const customerRow = await db.customers.get(newCustomerId);
    const orderRow = orderResult.id ? await db.orders.get(orderResult.id) : null;
    append(`Customer row after processing: ${JSON.stringify(customerRow)}`);
    append(`Order row after processing: ${JSON.stringify(orderRow)}`);
    append(
      orderRow?.syncStatus === "synced" && orderRow.orderNumber
        ? "✓ Both synced — the order's orderNumber is real, proving the customer's create was applied server-side first."
        : "Order not yet synced this pass — call 'Process queue' again if it was scheduled for backoff retry (check devtools was actually Offline during step 2)."
    );
    setRunning(false);
  }

  async function inspectCustomers() {
    setRunning(true);
    try {
      const db = getOfflineDb();
      await db.open();
      const rows = await db.customers.toArray();
      setLog([
        `customers (${rows.length} row${rows.length === 1 ? "" : "s"}):`,
        ...rows.map(
          (r) => `id=${r.id} name=${r.name} customerCode=${r.customerCode ?? "null (Pending sync…)"} syncStatus=${r.syncStatus}`
        ),
      ]);
    } catch (err) {
      setLog([`Error inspecting customers: ${err instanceof Error ? err.message : String(err)}`]);
    }
    setRunning(false);
  }

  async function checkGlobalSyncStatus() {
    setRunning(true);
    setLog([]);
    append("Calling readSyncStatusSummary() — the exact function SyncStatusIndicator (header pill) calls…");
    const result = await readSyncStatusSummary();
    append(`Result: ${JSON.stringify(result, null, 2)}`);
    setRunning(false);
  }

  async function checkCustomerBadge() {
    setRunning(true);
    setLog([]);
    append(`Calling readCustomerSyncBadge("${customerId}") — the exact function CustomerIdentityCard calls…`);
    const result = await readCustomerSyncBadge(customerId);
    append(`Result: ${JSON.stringify(result)}`);
    setRunning(false);
  }

  async function checkMeasurementBadge() {
    setRunning(true);
    setLog([]);
    append(`Calling readMeasurementSyncBadge("${customerId}") — the exact function MeasurementSyncBadge calls…`);
    const result = await readMeasurementSyncBadge(customerId);
    append(`Result: ${JSON.stringify(result)}`);
    setRunning(false);
  }

  async function checkOrderBadge() {
    setRunning(true);
    setLog([]);
    append(`Calling readOrderSyncBadge("${orderId}") — the exact function PendingOrdersNotice-style consumers would call…`);
    const result = await readOrderSyncBadge(orderId);
    append(`Result: ${JSON.stringify(result)}`);
    setRunning(false);
  }

  async function runRetryFailed() {
    setRunning(true);
    setLog([]);
    append("Calling retryFailedQueueItems() — the exact function the header pill's 'Retry failed' button calls…");
    const result = await retryFailedQueueItems();
    append(`Result: ${JSON.stringify(result)}`);
    if (result.retriedCount > 0) {
      append("Calling processSyncQueue() to actually attempt the retried item(s)…");
      const processResult = await processSyncQueue();
      append(`Process result: ${JSON.stringify(processResult, null, 2)}`);
    }
    setRunning(false);
  }

  async function runConsistencyCheck() {
    setRunning(true);
    setLog([]);
    append("Calling readConsistencyIssues() — the exact function SyncQueueBootstrap runs once on every app load…");
    const issues = await readConsistencyIssues();
    if (issues.length === 0) {
      append("No issues found — local records and the sync queue agree with each other.");
    } else {
      append(`${issues.length} issue(s) found (nothing was changed — diagnostic only):`);
      for (const issue of issues) {
        append(`- [${issue.kind}] ${issue.detail}`);
      }
    }
    setRunning(false);
  }

  async function runLocalSearch() {
    setRunning(true);
    setLog([]);
    append(`Calling searchCustomersLocally("${searchQuery}") — the exact function useCustomerSearch falls back to when the server search fails…`);
    const found = await searchCustomersLocally(searchQuery);
    append(`Result (${found.length}): ${JSON.stringify(found, null, 2)}`);
    setRunning(false);
  }

  return (
    <main style={{ fontFamily: "monospace", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18 }}>Phase 3/4/5/6 — Sync check</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        Dev-only verification tool. Not linked anywhere in the app. Requires you to be logged in to
        Sui Dhaga in this same browser (open <code>/login</code> first if you get an
        &quot;unauthorized&quot; result). Nothing here duplicates any sync logic — every button calls
        the exact same functions the real app uses.
      </p>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Phase 3 — Initial sync</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={runSync} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          {running ? "Working…" : "Run sync"}
        </button>
        <button onClick={readLocalCounts} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Read local (Dexie) counts
        </button>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Phase 4 — Order status sync queue</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        Paste a real <code>customerId</code>/<code>orderId</code> from this browser (e.g. from a
        Customer Profile or Order Detail URL: <code>/customers/&lt;customerId&gt;/orders/&lt;orderId&gt;</code>).
        To test the offline path, open devtools → Network → set Throttling to &quot;Offline&quot;
        before clicking &quot;Enqueue status change&quot;, then switch back to &quot;Online&quot; and
        click &quot;Process queue&quot; (or just wait — SyncQueueBootstrap does this automatically on
        the browser&apos;s own <code>online</code> event).
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="customerId"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 220 }}
        />
        <input
          placeholder="orderId"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 220 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 6, fontSize: 13 }}>
          <option>NEW</option>
          <option>STITCHING</option>
          <option>READY</option>
          <option>DELIVERED</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={enqueueChange} disabled={running || !customerId || !orderId} style={{ padding: "8px 16px", fontSize: 14 }}>
          Enqueue status change
        </button>
        <button onClick={runProcessor} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Process queue
        </button>
        <button onClick={inspectQueue} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Inspect queue
        </button>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Phase 5 — Customer create/edit sync queue</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        Same offline-simulation approach as Phase 4: toggle devtools → Network → Throttling →
        &quot;Offline&quot; before clicking Create/Update, then switch back to &quot;Online&quot; and
        click &quot;Process queue&quot; above (or wait for SyncQueueBootstrap&apos;s own reconnect
        listener).
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="name"
          value={custName}
          onChange={(e) => setCustName(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 200 }}
        />
        <input
          placeholder="phonePrimary (03XX-XXXXXXX)"
          value={custPhone}
          onChange={(e) => setCustPhone(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 200 }}
        />
        <button onClick={createCustomerLocal} disabled={running || !custName || !custPhone} style={{ padding: "8px 16px", fontSize: 14 }}>
          Create customer (local-first)
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <input
          placeholder="customerId to edit (auto-filled after create above)"
          value={editCustomerId}
          onChange={(e) => setEditCustomerId(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 280 }}
        />
        <input
          placeholder="new name"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 200 }}
        />
        <button onClick={updateCustomerLocal} disabled={running || !editCustomerId || !editName} style={{ padding: "8px 16px", fontSize: 14 }}>
          Update customer (local-first)
        </button>
        <button onClick={inspectCustomers} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Inspect local customers table
        </button>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Phase 6 — Measurement + order creation sync queue</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        Reuses the <code>customerId</code> field from the Phase 4 section above. Same offline-simulation
        approach: toggle devtools → Network → Throttling → &quot;Offline&quot; before clicking, then switch
        back to &quot;Online&quot; and click &quot;Process queue&quot; above.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="length (e.g. 44)"
          value={measLength}
          onChange={(e) => setMeasLength(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 140 }}
        />
        <button onClick={saveMeasurementLocal} disabled={running || !customerId} style={{ padding: "8px 16px", fontSize: 14 }}>
          Save measurement (local-first)
        </button>
        <input
          placeholder="totalAmount (e.g. 5000.00)"
          value={orderTotal}
          onChange={(e) => setOrderTotal(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 160 }}
        />
        <button onClick={createOrderLocal} disabled={running || !customerId} style={{ padding: "8px 16px", fontSize: 14 }}>
          Create order (local-first)
        </button>
        <button onClick={inspectOrdersAndMeasurements} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Inspect local orders/measurements
        </button>
      </div>
      <div style={{ marginTop: 8 }}>
        <button onClick={runDependencyDemo} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Run dependency demo (new customer + order, same session)
        </button>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Phase 7 — Sync status / badges</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        Reuses the <code>customerId</code>/<code>orderId</code> fields from the Phase 4 section above. The real
        header pill (visible on every page right now) and the Customer Profile badges call these exact same
        functions — this just prints the raw result for inspection.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={checkGlobalSyncStatus} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Read global sync summary
        </button>
        <button onClick={checkCustomerBadge} disabled={running || !customerId} style={{ padding: "8px 16px", fontSize: 14 }}>
          Read customer badge
        </button>
        <button onClick={checkMeasurementBadge} disabled={running || !customerId} style={{ padding: "8px 16px", fontSize: 14 }}>
          Read measurement badge
        </button>
        <button onClick={checkOrderBadge} disabled={running || !orderId} style={{ padding: "8px 16px", fontSize: 14 }}>
          Read order badge
        </button>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Phase 9 — Reliability / recovery</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        &quot;Retry failed&quot; reuses whatever is currently in the queue with status <code>failed</code> — enqueue
        something above, force it to fail (e.g. throttle to Offline, wait for it to exhaust its retries, or submit
        something the server will reject), then click Retry. &quot;Run consistency check&quot; is read-only and
        never changes anything.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={runRetryFailed} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Retry failed queue items
        </button>
        <button onClick={runConsistencyCheck} disabled={running} style={{ padding: "8px 16px", fontSize: 14 }}>
          Run consistency check
        </button>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Phase 11 — Local customer search</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        Try a name, a phone number, or a Customer Code (e.g. &quot;SD-000123&quot; or just its number) — matches the
        real fallback useCustomerSearch() uses when the server search fails, reading only this browser&apos;s local
        Dexie mirror (includes any not-yet-synced customer created here).
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="name / phone / customer code"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ padding: 6, fontSize: 13, fontFamily: "monospace", width: 260 }}
        />
        <button onClick={runLocalSearch} disabled={running || !searchQuery} style={{ padding: "8px 16px", fontSize: 14 }}>
          Search locally (Dexie)
        </button>
      </div>

      {log.length > 0 && (
        <pre style={{ marginTop: 20, background: "#f4f4f4", padding: 16, whiteSpace: "pre-wrap", fontSize: 13 }}>
          {log.join("\n")}
        </pre>
      )}
    </main>
  );
}
