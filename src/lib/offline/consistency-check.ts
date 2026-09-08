// Phase 9 (§7 — Local/Queue Consistency Check) — a small, read-only
// diagnostic over the EXISTING syncQueue + the EXISTING per-record
// syncStatus fields (Phase 2-8, unchanged). This is recovery/diagnostic
// tooling only: it NEVER deletes, modifies, or "fixes" anything — it
// only reports what it finds so a human (via /dev/sync-check, or a
// console warning at app startup — see sync-queue-bootstrap.tsx) can
// look into it.
//
// Same two-part split as sync-status.ts (Phase 7): a pure function
// taking plain data (testable without Dexie/a browser — see
// test-phase9.mjs) plus a thin Dexie-reading wrapper.
import { getOfflineDb, isOfflineDbAvailable } from "./db";
import type { SyncQueueItem, SyncOp, SyncStatus } from "./types";

export type ConsistencyIssueKind =
  | "orphaned-queue-item"
  | "malformed-payload"
  | "pending-without-queue-item"
  | "conflict-without-queue-item";

export interface ConsistencyIssue {
  kind: ConsistencyIssueKind;
  /** Plain-English, non-sensitive detail: ids/ops/table names only — never a name, phone, address, or raw payload value (§7's own "do not expose sensitive information" rule). */
  detail: string;
}

interface QueueItemLike {
  op: SyncOp;
  payload: unknown;
  status: SyncQueueItem["status"];
}

export interface ConsistencyInput {
  queueItems: QueueItemLike[];
  customerIds: string[];
  customerSyncStatuses: { id: string; syncStatus: SyncStatus }[];
  measurementCustomerIds: string[];
  measurementSyncStatuses: { customerId: string; syncStatus: SyncStatus }[];
  orderIds: string[];
  orderSyncStatuses: { id: string; syncStatus: SyncStatus }[];
}

/** Which local-record id (if any) a queue item's payload claims to belong to, for the given op — reads only known, documented payload field names (sync-engine.ts's own Payload interfaces), never arbitrary data. */
function payloadRecordId(op: SyncOp, payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  switch (op) {
    case "CREATE_CUSTOMER":
      return typeof p.id === "string" ? p.id : null;
    case "UPDATE_CUSTOMER":
      return typeof p.customerId === "string" ? p.customerId : null;
    case "SAVE_MEASUREMENT":
      return typeof p.customerId === "string" ? p.customerId : null;
    case "CREATE_ORDER":
      return typeof p.id === "string" ? p.id : null;
    case "UPDATE_ORDER_STATUS":
      return typeof p.orderId === "string" ? p.orderId : null;
    default:
      return null;
  }
}

/** Required payload fields per op — the same fields each op's own enqueue/apply-sync module already expects (sync-engine.ts / customer-sync.ts / measurement-sync.ts / order-create-sync.ts / order-status-update.ts). Not re-validating VALUES (that's Zod's job server-side) — only that the shape itself isn't obviously broken. */
const REQUIRED_PAYLOAD_FIELDS: Partial<Record<SyncOp, string[]>> = {
  CREATE_CUSTOMER: ["id", "name", "phonePrimary"],
  UPDATE_CUSTOMER: ["customerId", "name", "phonePrimary", "baseUpdatedAt"],
  SAVE_MEASUREMENT: ["customerId"],
  CREATE_ORDER: ["id", "customerId", "fields"],
  UPDATE_ORDER_STATUS: ["customerId", "orderId", "status"],
};

// Ops whose enqueue function writes the referenced local record in the
// SAME Dexie transaction as the queue item itself — for these, the
// local record is GUARANTEED to still exist as long as nothing deletes
// local rows (nothing in this app ever does), so a missing one is a
// genuine anomaly. UPDATE_ORDER_STATUS is deliberately excluded: its
// own enqueue function (enqueueOrderStatusUpdate) documents that a
// missing local order row is an EXPECTED, harmless no-op (Phase 4) when
// Phase 3's initial sync hasn't populated it yet — flagging that here
// would be a false positive, not a real problem.
const OPS_WITH_GUARANTEED_LOCAL_RECORD: SyncOp[] = ["CREATE_CUSTOMER", "UPDATE_CUSTOMER", "SAVE_MEASUREMENT", "CREATE_ORDER"];

export function computeConsistencyIssues(input: ConsistencyInput): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const customerIdSet = new Set(input.customerIds);
  const measurementCustomerIdSet = new Set(input.measurementCustomerIds);
  const orderIdSet = new Set(input.orderIds);

  // Only non-synced items are worth checking — a "synced" item has
  // already done its job; its referenced record existing or not is no
  // longer this check's concern.
  const activeItems = input.queueItems.filter((item) => item.status !== "synced");

  for (const item of activeItems) {
    const requiredFields = REQUIRED_PAYLOAD_FIELDS[item.op];
    if (requiredFields) {
      const payload = typeof item.payload === "object" && item.payload !== null ? (item.payload as Record<string, unknown>) : null;
      const isMalformed = !payload || requiredFields.some((field) => !(field in payload));
      if (isMalformed) {
        issues.push({ kind: "malformed-payload", detail: `A ${item.op} queue item (status: ${item.status}) is missing an expected payload field.` });
        continue; // nothing further to check against local records if the shape itself is broken
      }
    }

    if (!OPS_WITH_GUARANTEED_LOCAL_RECORD.includes(item.op)) continue;
    const recordId = payloadRecordId(item.op, item.payload);
    if (recordId === null) continue;

    let recordExists = true;
    if (item.op === "CREATE_CUSTOMER" || item.op === "UPDATE_CUSTOMER") {
      recordExists = customerIdSet.has(recordId);
    } else if (item.op === "SAVE_MEASUREMENT") {
      recordExists = measurementCustomerIdSet.has(recordId);
    } else if (item.op === "CREATE_ORDER") {
      recordExists = orderIdSet.has(recordId);
    }
    if (!recordExists) {
      issues.push({ kind: "orphaned-queue-item", detail: `A ${item.op} queue item (status: ${item.status}) references a local record that no longer exists.` });
    }
  }

  function hasActiveItemFor(op: SyncOp, recordId: string): boolean {
    return activeItems.some((item) => item.op === op && payloadRecordId(item.op, item.payload) === recordId);
  }

  for (const { id, syncStatus } of input.customerSyncStatuses) {
    if (syncStatus === "pending" && !hasActiveItemFor("CREATE_CUSTOMER", id) && !hasActiveItemFor("UPDATE_CUSTOMER", id)) {
      issues.push({ kind: "pending-without-queue-item", detail: `Customer ${id} is marked pending but has no queued sync operation.` });
    }
    if (syncStatus === "conflict") {
      const hasFailedItem = input.queueItems.some((item) => item.status === "failed" && item.op === "UPDATE_CUSTOMER" && payloadRecordId(item.op, item.payload) === id);
      if (!hasFailedItem) {
        issues.push({ kind: "conflict-without-queue-item", detail: `Customer ${id} is marked as a conflict but has no matching failed sync operation.` });
      }
    }
  }

  for (const { customerId, syncStatus } of input.measurementSyncStatuses) {
    if (syncStatus === "pending" && !hasActiveItemFor("SAVE_MEASUREMENT", customerId)) {
      issues.push({ kind: "pending-without-queue-item", detail: `Measurement for customer ${customerId} is marked pending but has no queued sync operation.` });
    }
  }

  for (const { id, syncStatus } of input.orderSyncStatuses) {
    if (syncStatus === "pending" && !hasActiveItemFor("CREATE_ORDER", id) && !hasActiveItemFor("UPDATE_ORDER_STATUS", id)) {
      issues.push({ kind: "pending-without-queue-item", detail: `Order ${id} is marked pending but has no queued sync operation.` });
    }
  }

  return issues;
}

/** Reads the real Dexie tables and runs the same pure check above. Never deletes/modifies anything — purely diagnostic (Phase 9 §7/§8). */
export async function readConsistencyIssues(): Promise<ConsistencyIssue[]> {
  if (!isOfflineDbAvailable()) return [];
  const db = getOfflineDb();
  await db.open();

  const [queueItems, customers, measurements, orders] = await Promise.all([
    db.syncQueue.toArray(),
    db.customers.toArray(),
    db.measurements.toArray(),
    db.orders.toArray(),
  ]);

  return computeConsistencyIssues({
    queueItems: queueItems.map((item) => ({ op: item.op, payload: item.payload, status: item.status })),
    customerIds: customers.map((c) => c.id),
    customerSyncStatuses: customers.map((c) => ({ id: c.id, syncStatus: c.syncStatus })),
    measurementCustomerIds: measurements.map((m) => m.customerId),
    measurementSyncStatuses: measurements.map((m) => ({ customerId: m.customerId, syncStatus: m.syncStatus })),
    orderIds: orders.map((o) => o.id),
    orderSyncStatuses: orders.map((o) => ({ id: o.id, syncStatus: o.syncStatus })),
  });
}
