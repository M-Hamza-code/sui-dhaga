"use client";

// Step 56 (Issue 4) — Order Board's per-row delete action. Uses the
// project's existing/original delete icon style: lucide-react's Trash2
// (the standard trash/delete glyph), the first icon-library dependency
// this project adds — settings-menu.tsx's own GearIcon comment noted
// "the project has none" as of Step 51; asked for by name here (Trash2/
// SlidersHorizontal), so it's added rather than hand-approximated.
//
// Reuses useDeleteOrder (use-delete-order.ts) — the exact same Step 55
// local-first delete-order.ts's own comment: after a successful delete,
// this row's order is already gone from Dexie/Postgres; router.refresh()
// re-fetches the Order Board's own Server Component data so the row
// disappears in place, the same "re-fetch to reflect a local-first
// mutation" pattern order-status-form.tsx already established — no
// navigation away, unlike delete-order-button.tsx's Order Detail
// destination (there is no "detail page" concept to leave from here).
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useDeleteOrder } from "./use-delete-order";
import { en } from "@/lib/locale";

export function DeleteOrderIconButton({
  customerId,
  orderId,
  orderNumberDisplay,
}: {
  customerId: string;
  orderId: string;
  /** Already-formatted (formatOrderNumber) — used only in the confirmation prompt. */
  orderNumberDisplay: string;
}) {
  const router = useRouter();
  const { deleting, error, deleteOrder } = useDeleteOrder(customerId, orderId, orderNumberDisplay);

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    // Each cell in this row is its own <Link> (order-board-table.tsx's
    // own established pattern) rather than the whole <tr> — this cell
    // has no Link to fight, but stopping propagation keeps this action
    // self-contained regardless of how the row around it evolves.
    event.stopPropagation();
    deleteOrder(() => router.refresh());
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {error && (
        <span role="alert" className="text-xs text-amber">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={deleting}
        aria-label={en.orderBoard.deleteOrderAriaLabel}
        title={en.orderBoard.deleteOrderAriaLabel}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-sm text-graphite/40 transition hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
