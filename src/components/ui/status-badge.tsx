import type { OrderStatus } from "@prisma/client";
import { en } from "@/lib/locale";

// Step 10 status foundation. Step 49 — READY now reads in the `success`
// token (Step 46 addition) instead of solid indigo: indigo is reserved
// for primary actions/in-progress (STITCHING), success/green is the
// correct "positive, completed-enough-to-hand-over" meaning per the
// design system's own color rules. Amber is deliberately NOT used here:
// it's reserved for attention states (overdue, changed measurements,
// outstanding balance), not as a routine "in progress" indicator.
// PENDING is legacy (Step 9) and renders identically to NEW — both mean
// "not yet delivered".
//
// Exported (Step 49) so order-status-form.tsx's editable status <select>
// can tint itself with the exact same tone mapping — one source of truth
// for "what color means what status" instead of a second, potentially
// drifting copy of these rules.
export const STATUS_TONE: Record<OrderStatus, string> = {
  PENDING: "border-rule bg-paper text-graphite",
  NEW: "border-rule bg-paper text-graphite",
  STITCHING: "border-indigo/30 bg-indigo/10 text-indigo",
  READY: "border-success bg-success text-white",
  DELIVERED: "border-rule bg-card text-graphite/70",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}
    >
      {en.status[status]}
    </span>
  );
}
