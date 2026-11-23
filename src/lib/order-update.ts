import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateOrderInput } from "@/lib/order-actions";
import { newOrderItemFields, updatedOrderItemFields, type ValidatedOrderInput } from "@/lib/order-build";

// Step 53 — Edit Order. Server-side logic for the new
// /api/sync/order-update Route Handler, following the exact same shape
// order-create-sync.ts's applyOrderCreateSync and customer-sync.ts's
// applyCustomerUpdateSync already established for their own ops — no new
// pattern is introduced here:
//   - validation: validateOrderInput() (order-actions.ts), completely
//     unchanged and untouched — the exact same style/money/measurement/
//     DesignOption/per-suit-style rule order creation already enforces.
//   - conflict guard: an ATOMIC conditional update (`updateMany` with
//     `updatedAt` in the WHERE clause, checking `count === 1`) — not a
//     separate read-then-write, which would leave a genuine TOCTOU gap
//     between the version check and the write.
//   - MeasurementSnapshot immutability: every save creates a BRAND NEW
//     snapshot (order's own default, and any per-suit override) and
//     repoints the order/item at it. The previous snapshot row is never
//     updated or deleted — it simply becomes unreferenced, exactly the
//     same "independent, frozen copy, never mutated" rule
//     schema.prisma's own MeasurementSnapshot comment describes.
//
// Idempotency receipts (SyncOperationReceipt) — UPDATE_ORDER only. This
// op's effect spans Order's own scalars, a brand-new MeasurementSnapshot,
// and the OrderItem rows in one transaction — comparing Order's scalars
// alone after a retried request cannot tell "this exact request already
// applied" from "a different request coincidentally produced the same
// scalars with different items". `idempotencyKey` (the client's queue
// item's own, stable-across-retries id) is the receipt's `operationId`;
// `payloadHash` binds it to the EXACT request (including the concurrency
// baseline and customer context — see computeOrderUpdatePayloadHash),
// never just "this operationId, whatever its content is this time".
//
// Quantity change is the one genuinely new piece of orchestration here
// (order creation only ever creates items, never reconciles an existing
// set): OrderItem rows beyond the new quantity are deleted (never their
// MeasurementSnapshot, per the rule above); surviving positions are
// updated in place; positions beyond the old quantity are created fresh
// — using newOrderItemFields, the exact same per-item shape order
// creation's own buildOrderCreateData already produces.

export type OrderUpdateSyncResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "customer-not-found" }
  | { ok: false; reason: "order-not-found" }
  | { ok: false; reason: "invalid-input"; message: string }
  | { ok: false; reason: "conflict"; serverUpdatedAt: string }
  // The receipt table already has a committed result for this
  // operationId under a DIFFERENT payload (or a different target order —
  // a real crypto.randomUUID() collision, vanishingly unlikely, or a
  // genuine client bug reusing a key). Permanent — never a stale-version
  // conflict, so the Route Handler must map this to its own distinct
  // status (422 with an explicit `code`), never 409.
  | { ok: false; reason: "idempotency-key-reuse" };

/** Recursively sorts object keys and normalizes Date -> ISO string / undefined -> null, WITHOUT reordering arrays (their own position is already semantically meaningful — see every itemOverrides/itemStyles/... array, which is canonical by construction). */
function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * The canonical content an UPDATE_ORDER request is hashed from — every
 * field `buildOrderUpdateData`/`newOrderItemFields`/`updatedOrderItemFields`
 * can write (confirmed exhaustively: the four parallel item arrays +
 * quantity cover every OrderItem field; the top-level scalars cover every
 * Order field), plus `baseUpdatedAt` (the concurrency baseline actually
 * used — a request with the same intended data but a different baseline
 * is not an identical retry) and `customerId` (the order's own context —
 * free to include since it's already part of the transmitted request,
 * and guards against an operationId collision landing on an unrelated
 * customer going unnoticed).
 *
 * `pocketOptionId`/`pattiOptionId`/`panchaOptionId` are normalized with
 * `|| null` to match the TRUTHINESS check buildOrderUpdateData's own
 * write path uses (undefined/empty-string/null all produce the same
 * "disconnect" effect there) — every other optional scalar on
 * ValidatedOrderInput is already coalesced to null by validateOrderInput
 * itself before this function ever sees it, so no other field needs
 * normalizing here.
 */
export function computeOrderUpdatePayloadHash(validated: ValidatedOrderInput, baseUpdatedAt: string, customerId: string): string {
  const canonical = canonicalize({
    orderDate: validated.orderDate,
    deliveryDate: validated.deliveryDate,
    measurementMode: validated.measurementMode,
    suitType: validated.suitType,
    collarType: validated.collarType,
    bainType: validated.bainType,
    cuffType: validated.cuffType,
    gheraType: validated.gheraType,
    pocketOptionId: validated.pocketOptionId || null,
    pattiOptionId: validated.pattiOptionId || null,
    panchaOptionId: validated.panchaOptionId || null,
    totalAmount: validated.totalAmount,
    advanceAmount: validated.advanceAmount,
    balanceAmount: validated.balanceAmount,
    princeCoatUnitPrice: validated.princeCoatUnitPrice,
    waistcoatUnitPrice: validated.waistcoatUnitPrice,
    note: validated.note,
    quantity: validated.quantity,
    defaultSnapshotData: validated.defaultSnapshotData,
    itemOverrides: validated.itemOverrides,
    itemStyles: validated.itemStyles,
    itemMeasurementModes: validated.itemMeasurementModes,
    itemCoatGarmentSelections: validated.itemCoatGarmentSelections,
    baseUpdatedAt,
    customerId,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** True only for a P2002 whose constraint metadata specifically names the receipt's own `operationId` unique index — never a bare P2002, since OrderItem's own `@@unique([orderId, position])` could in principle also raise one, and misclassifying THAT as idempotency-key-reuse would hide a real, unrelated bug behind a misleading error. */
function isOperationIdCollision(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as unknown[]).includes("operationId")
  );
}

function receiptMatches(receipt: { operationType: string; targetId: string; payloadHash: string } | null, orderId: string, payloadHash: string): boolean {
  return !!receipt && receipt.operationType === "UPDATE_ORDER" && receipt.targetId === orderId && receipt.payloadHash === payloadHash;
}

export async function applyOrderUpdateSync(
  customerId: string,
  orderId: string,
  formData: FormData,
  baseUpdatedAt: string,
  idempotencyKey: string
): Promise<OrderUpdateSyncResult> {
  // Validate first (cheap, no DB write) — same ordering validateOrderInput's
  // other two callers (createOrder, applyOrderCreateSync) already use.
  const result = await validateOrderInput(formData);
  if ("error" in result) {
    return { ok: false, reason: "invalid-input", message: result.error };
  }
  const validated = result.data;
  const payloadHash = computeOrderUpdatePayloadHash(validated, baseUpdatedAt, customerId);

  // Step 0 — replay check, before any other work. A lost-response retry
  // (same operationId, same frozen baseline, so the same hash) replays
  // here without ever touching the database again.
  const existingReceipt = await prisma.syncOperationReceipt.findUnique({ where: { operationId: idempotencyKey } });
  if (existingReceipt) {
    if (receiptMatches(existingReceipt, orderId, payloadHash)) {
      return { ok: true, updatedAt: existingReceipt.resultUpdatedAt.toISOString() };
    }
    return { ok: false, reason: "idempotency-key-reuse" };
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    return { ok: false, reason: "customer-not-found" };
  }

  // The order must belong to the customer in the URL/payload — never act
  // on an order just because its id was guessed/reused under a different
  // customer's path. Same rule applyOrderStatusUpdate already enforces.
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!existing || existing.customerId !== customerId) {
    return { ok: false, reason: "order-not-found" };
  }

  const oldCount = existing.items.length;
  const newCount = validated.quantity;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Scalar-only fields, converted from buildOrderUpdateData's own
      // relation-connect/disconnect syntax to plain FK scalars (the
      // identical database effect — connect = set the id, disconnect =
      // set null) because updateMany cannot express nested relation
      // writes at all. The snapshot's nested `create` is pulled out as
      // its own step below, run only after this conditional update
      // actually commits.
      const scalarFields: Prisma.OrderUncheckedUpdateManyInput = {
        deliveryDate: validated.deliveryDate,
        measurementMode: validated.measurementMode,
        suitType: validated.suitType,
        collarType: validated.collarType,
        bainType: validated.bainType,
        cuffType: validated.cuffType,
        gheraType: validated.gheraType,
        pocketOptionId: validated.pocketOptionId || null,
        pattiOptionId: validated.pattiOptionId || null,
        panchaOptionId: validated.panchaOptionId || null,
        totalAmount: validated.totalAmount,
        advanceAmount: validated.advanceAmount,
        balanceAmount: validated.balanceAmount,
        princeCoatUnitPrice: validated.princeCoatUnitPrice,
        waistcoatUnitPrice: validated.waistcoatUnitPrice,
        note: validated.note,
      };

      // The one atomic, single-statement conditional check — no separate
      // read-then-write, so no TOCTOU gap between checking the version
      // and writing it.
      const conditional = await tx.order.updateMany({
        where: { id: orderId, updatedAt: new Date(baseUpdatedAt) },
        data: scalarFields,
      });

      if (conditional.count !== 1) {
        // Same-row race: by the time this statement unblocks (Postgres's
        // default READ COMMITTED gives each statement its own snapshot,
        // not one for the whole transaction — confirmed via a repo-wide
        // grep finding no isolationLevel override anywhere), the winning
        // transaction has already committed, so this plain read correctly
        // sees its receipt if there is one.
        const raceReceipt = await tx.syncOperationReceipt.findUnique({ where: { operationId: idempotencyKey } });
        if (receiptMatches(raceReceipt, orderId, payloadHash)) {
          return { kind: "replay" as const, updatedAt: raceReceipt!.resultUpdatedAt };
        }
        return { kind: "conflict" as const };
      }

      // New default snapshot, only now that the conditional update has
      // actually committed — avoids an orphan snapshot if the request
      // had turned out to be stale. The scalar update above already took
      // this row's lock, so this follow-up plain update is safe without
      // any further locking of its own.
      const newSnapshot = await tx.measurementSnapshot.create({ data: validated.defaultSnapshotData });
      await tx.order.update({ where: { id: orderId }, data: { defaultMeasurementSnapshotId: newSnapshot.id } });

      // Fewer suits: drop the now-unneeded item rows. Their own
      // MeasurementSnapshot (if any) is never touched — it just becomes
      // unreferenced, same as every replaced snapshot in this flow.
      if (newCount < oldCount) {
        await tx.orderItem.deleteMany({ where: { orderId, position: { gt: newCount } } });
      }

      for (let position = 1; position <= newCount; position++) {
        const override = validated.itemOverrides[position - 1] ?? null;
        const styleOverride = validated.itemStyles[position - 1] ?? null;
        const itemMode = validated.itemMeasurementModes[position - 1] ?? null;
        const itemCoatGarmentSelection = validated.itemCoatGarmentSelections[position - 1] ?? null;
        if (position <= oldCount) {
          await tx.orderItem.update({
            where: { orderId_position: { orderId, position } },
            data: updatedOrderItemFields(override, styleOverride, itemMode, itemCoatGarmentSelection),
          });
        } else {
          // More suits: create the newly-added positions exactly like a
          // fresh order would — never a second, drifting definition of
          // "what a new suit's row looks like".
          await tx.orderItem.create({
            data: {
              ...newOrderItemFields(override, styleOverride, itemMode, itemCoatGarmentSelection),
              position,
              order: { connect: { id: orderId } },
            },
          });
        }
      }

      const finalOrder = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

      await tx.syncOperationReceipt.create({
        data: {
          operationId: idempotencyKey,
          operationType: "UPDATE_ORDER",
          targetId: orderId,
          payloadHash,
          resultUpdatedAt: finalOrder.updatedAt,
        },
      });

      return { kind: "success" as const, updatedAt: finalOrder.updatedAt };
    });

    if (outcome.kind === "conflict") {
      // Fresh read — not the pre-transaction `existing`, which is now
      // stale by definition (that's exactly what just failed the
      // conditional check) — so Keep Local gets a baseline that is
      // actually current, not the one already known to be wrong.
      const current = await prisma.order.findUnique({ where: { id: orderId } });
      return { ok: false, reason: "conflict", serverUpdatedAt: (current?.updatedAt ?? existing.updatedAt).toISOString() };
    }
    return { ok: true, updatedAt: outcome.updatedAt.toISOString() };
  } catch (err) {
    if (isOperationIdCollision(err)) {
      // Cross-row race: a different target Order's own concurrent
      // transaction committed a receipt under this exact operationId
      // first — the two don't share a row lock, so the `operationId`
      // @unique constraint itself is what serializes them. Recovery is a
      // fresh read outside this now-aborted transaction.
      const raceReceipt = await prisma.syncOperationReceipt.findUnique({ where: { operationId: idempotencyKey } });
      if (receiptMatches(raceReceipt, orderId, payloadHash)) {
        return { ok: true, updatedAt: raceReceipt!.resultUpdatedAt.toISOString() };
      }
      return { ok: false, reason: "idempotency-key-reuse" };
    }
    throw err;
  }
}
