// Phase 3 — Initial Server → Local Database Sync.
//
// A new, additive, READ-ONLY Route Handler. It does not replace, wrap,
// or change any existing Server Action — createCustomer, createOrder,
// createCustomerAndOrder, saveMeasurement, updateOrderStatus,
// updateShopSettings all continue to be the only way any of this data
// is ever written. This endpoint only ever reads.
//
// Authentication: reuses getSession() from @/lib/auth verbatim — the
// exact same stateless, HMAC-verified cookie check every existing
// Server Action already performs independently of middleware.ts. This
// route sits under /api/sync/, which is NOT covered by middleware.ts's
// matcher (that list only covers page routes: /dashboard, /overview,
// /customers, /orders, /settings, /login) — so, exactly like every
// Server Action already does ("an action is its own entry point and
// should not rely solely on the page that happened to render its
// form"), this endpoint performs its own complete auth check rather
// than depending on middleware for protection. middleware.ts itself is
// left completely untouched; extending its matcher to also cover
// /api/sync was considered and deliberately not done, since it would
// add nothing this route doesn't already enforce itself, and the task's
// standing rule is to avoid touching a working, explicitly-protected
// file unless doing so is the only way to make something correct.
//
// Scope, exactly per the approved Phase 3 task:
//   - customers: active (non-deleted) only, per the task's own instruction.
//   - orders: scoped to those same active customers, so nothing local
//     ever references a customerId that isn't also present in the local
//     `customers` table.
//   - measurements: every customer's current Measurement row (no
//     deletedAt filter of its own — mirrors how the server itself never
//     filters Measurement by the owning customer's soft-delete status).
//   - measurementSnapshots / orderItems: flattened out of each order's
//     own defaultMeasurementSnapshot + items[].measurementSnapshot,
//     which is exactly the graph order-build.ts already writes — nothing
//     invented, nothing guessed.
//   - designOptions: all rows (active and inactive) — a past order can
//     reference an option later deactivated by the owner; keeping the
//     inactive ones too means that order's pocket choice still displays
//     correctly offline instead of resolving to "unknown option".
//   - shopSettings: the single row, or null on a brand-new install that
//     has never had one (mirrors every existing page's own
//     `findUnique(...) ?? null` handling of this same table).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ALL_COAT_FIELD_KEYS } from "@/lib/coat-measurement-fields";

// This endpoint reads live session cookies and must never be cached —
// getSession()'s use of next/headers' cookies() already forces dynamic
// rendering, but this is stated explicitly rather than left implicit,
// given how security/freshness-sensitive a sync endpoint is.
export const dynamic = "force-dynamic";

function decimalToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [customers, measurements, coatMeasurements, orders, designOptions, shopSettings] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        customerCode: true,
        name: true,
        phonePrimary: true,
        phoneSecondary: true,
        address: true,
        deletedAt: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.measurement.findMany({
      where: { customer: { deletedAt: null } },
    }),
    prisma.coatMeasurement.findMany({
      where: { customer: { deletedAt: null } },
    }),
    prisma.order.findMany({
      where: { customer: { deletedAt: null } },
      include: {
        defaultMeasurementSnapshot: true,
        items: { include: { measurementSnapshot: true }, orderBy: { position: "asc" } },
      },
    }),
    prisma.designOption.findMany(),
    prisma.shopSettings.findUnique({ where: { singleton: true } }),
  ]);

  const measurementSnapshots: Record<string, unknown>[] = [];
  const orderItems: Record<string, unknown>[] = [];

  function shapeSnapshot(s: NonNullable<(typeof orders)[number]["defaultMeasurementSnapshot"]>) {
    const coatFields: Record<string, string | null> = {};
    for (const key of ALL_COAT_FIELD_KEYS) {
      coatFields[key] = decimalToString((s as unknown as Record<string, unknown>)[key]);
    }
    return {
      id: s.id,
      length: decimalToString(s.length),
      shoulder: decimalToString(s.shoulder),
      sleeve: decimalToString(s.sleeve),
      armHole: decimalToString(s.armHole),
      kohni: decimalToString(s.kohni),
      neck: decimalToString(s.neck),
      chest: decimalToString(s.chest),
      waist: decimalToString(s.waist),
      hem: decimalToString(s.hem),
      shalwarLength: decimalToString(s.shalwarLength),
      pancha: decimalToString(s.pancha),
      shalwarPocket: s.shalwarPocket,
      shalwarGheraReady: decimalToString(s.shalwarGheraReady),
      ...coatFields,
      note: s.note,
      isBackfilled: s.isBackfilled,
      createdAt: s.createdAt.toISOString(),
    };
  }

  const orderRows = orders.map((o) => {
    if (o.defaultMeasurementSnapshot) {
      measurementSnapshots.push(shapeSnapshot(o.defaultMeasurementSnapshot));
    }
    for (const item of o.items) {
      if (item.measurementSnapshot) {
        measurementSnapshots.push(shapeSnapshot(item.measurementSnapshot));
      }
      orderItems.push({
        id: item.id,
        orderId: item.orderId,
        position: item.position,
        measurementSnapshotId: item.measurementSnapshotId,
        // NOTE: suitType/collarType/bainType/cuffType/gheraType/
        // pocketOptionId were already absent from this payload before
        // this upgrade (a pre-existing gap — per-suit style overrides
        // never flowed through initial sync, only through a live
        // CREATE_ORDER/UPDATE_ORDER sync) — left as-is, not silently
        // fixed here, since it's unrelated to this feature. Flagged in
        // the implementation report.
        measurementMode: item.measurementMode,
        // Explicit garment selection upgrade — threaded through the same
        // way measurementMode already is, so an offline device's local
        // mirror can resolve a Coat item's pricing without a live
        // network round-trip (see order-print-data.ts's own NULL ->
        // "BOTH" fallback for why the raw value is passed through as-is,
        // not pre-resolved, here).
        coatGarmentSelection: item.coatGarmentSelection,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      });
    }

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customerId,
      orderDate: o.orderDate.toISOString(),
      deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString() : null,
      measurementMode: o.measurementMode,
      suitType: o.suitType,
      collarType: o.collarType,
      bainType: o.bainType,
      cuffType: o.cuffType,
      gheraType: o.gheraType,
      pocketOptionId: o.pocketOptionId,
      pattiOptionId: o.pattiOptionId,
      panchaOptionId: o.panchaOptionId,
      defaultMeasurementSnapshotId: o.defaultMeasurementSnapshotId,
      totalAmount: decimalToString(o.totalAmount),
      advanceAmount: decimalToString(o.advanceAmount),
      balanceAmount: decimalToString(o.balanceAmount),
      princeCoatUnitPrice: decimalToString(o.princeCoatUnitPrice),
      waistcoatUnitPrice: decimalToString(o.waistcoatUnitPrice),
      status: o.status,
      createdById: o.createdById,
      note: o.note,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      // The server's own confirmed version, for the offline queue's
      // baseline-freeze mechanism (see LocalOrder.baseUpdatedAt's own
      // comment) — same value as updatedAt at pull time by definition,
      // kept as a separate field so a later local edit's own bumped
      // updatedAt never gets mistaken for a confirmed baseline.
      baseUpdatedAt: o.updatedAt.toISOString(),
    };
  });

  return NextResponse.json({
    pulledAt: new Date().toISOString(),
    customers: customers.map((c) => ({
      id: c.id,
      customerCode: c.customerCode,
      name: c.name,
      phonePrimary: c.phonePrimary,
      phoneSecondary: c.phoneSecondary,
      address: c.address,
      deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
      createdById: c.createdById,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      // See the matching comment on the `orders` mapping below.
      baseUpdatedAt: c.updatedAt.toISOString(),
    })),
    measurements: measurements.map((m) => ({
      id: m.id,
      customerId: m.customerId,
      length: decimalToString(m.length),
      shoulder: decimalToString(m.shoulder),
      sleeve: decimalToString(m.sleeve),
      armHole: decimalToString(m.armHole),
      kohni: decimalToString(m.kohni),
      neck: decimalToString(m.neck),
      chest: decimalToString(m.chest),
      waist: decimalToString(m.waist),
      hem: decimalToString(m.hem),
      shalwarLength: decimalToString(m.shalwarLength),
      pancha: decimalToString(m.pancha),
      shalwarPocket: m.shalwarPocket,
      shalwarGheraReady: decimalToString(m.shalwarGheraReady),
      note: m.note,
      updatedById: m.updatedById,
      updatedAt: m.updatedAt.toISOString(),
    })),
    coatMeasurements: coatMeasurements.map((m) => {
      const coatFields: Record<string, string | null> = {};
      for (const key of ALL_COAT_FIELD_KEYS) {
        coatFields[key] = decimalToString((m as unknown as Record<string, unknown>)[key]);
      }
      return {
        id: m.id,
        customerId: m.customerId,
        ...coatFields,
        note: m.note,
        updatedById: m.updatedById,
        updatedAt: m.updatedAt.toISOString(),
      };
    }),
    orders: orderRows,
    orderItems,
    measurementSnapshots,
    designOptions: designOptions.map((d) => ({
      id: d.id,
      category: d.category,
      code: d.code,
      label: d.label,
      sortOrder: d.sortOrder,
      isActive: d.isActive,
    })),
    shopSettings: shopSettings
      ? {
          id: shopSettings.id,
          singleton: true as const,
          name: shopSettings.name,
          phone: shopSettings.phone,
          address: shopSettings.address,
          tagline: shopSettings.tagline,
          defaultPrices: shopSettings.defaultPrices,
          defaultAdvancePercent: decimalToString(shopSettings.defaultAdvancePercent),
          updatedAt: shopSettings.updatedAt.toISOString(),
        }
      : null,
    // Backup & Restore — bumped by 1 every time a restore completes (see
    // src/lib/restore/restore-actions.ts). 0 when ShopSettings doesn't
    // exist yet, same as a brand-new install that's never had a restore.
    restoreGeneration: shopSettings?.restoreGeneration ?? 0,
  });
}
