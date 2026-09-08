import Link from "next/link";
import type { Order, Customer } from "@prisma/client";
import { formatDate, formatMoney, formatOrderNumber } from "@/lib/format";
import { OrderStatusForm } from "./order-status-form";
import { en } from "@/lib/locale";

export type OrderBoardRow = Pick<Order, "id" | "orderNumber" | "customerId" | "deliveryDate" | "balanceAmount" | "status"> & {
  customer: Pick<Customer, "name" | "phonePrimary">;
  _count: { items: number };
};

// S4 Order Board dense table (Step 15). A real <table>, not the
// CSS-grid/card patterns used elsewhere (S2's order history) — the brief
// asks for this to be "a table, not cards" and a scanning surface, which
// a native table serves best.
//
// Every cell except Status is wrapped in its own <Link> to the existing
// order detail route — not the whole <tr>, because the Status cell holds
// a real <form>/<select>, and nesting interactive elements inside an <a>
// is both invalid HTML and would make clicking the dropdown ambiguous
// with navigating the row. This keeps the row fully clickable everywhere
// that matters while the dropdown stays completely independent.
//
// Step 49 — presentation-only polish: bolder header type, a touch more
// row padding and a subtle indigo-tinted hover (still layered so it
// never fights the amber overdue accent), and the order number/customer
// name columns given clearer visual weight. Every column, every Link
// href, the overdue detection (`isOverdue`), and OrderStatusForm's props
// are all unchanged — still exactly the same data, same links, same
// dense one-row-per-order table.
export function OrderBoardTable({
  orders,
  todayStart,
  redirectTo,
}: {
  orders: OrderBoardRow[];
  /** Local midnight today — used only to flag a row overdue, same definition the Overdue tab itself uses. */
  todayStart: Date;
  /** Where the status form redirects back to after a change — the board's own URL (current tab included). */
  redirectTo: string;
}) {
  return (
    <div className="overflow-x-auto rounded-sm border border-rule bg-card shadow-sm">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-rule bg-paper text-left text-xs font-semibold uppercase tracking-wide text-graphite/60">
            <Th className="pl-4">{en.orderBoard.columns.orderNo}</Th>
            <Th>{en.orderBoard.columns.customer}</Th>
            <Th>{en.orderBoard.columns.phone}</Th>
            <Th>{en.orderBoard.columns.deliveryDate}</Th>
            <Th className="text-right">{en.orderBoard.columns.suits}</Th>
            <Th className="text-right">{en.orderBoard.columns.balance}</Th>
            <Th className="pr-4">{en.orderBoard.columns.status}</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const isOverdue = Boolean(order.deliveryDate && order.deliveryDate < todayStart && order.status !== "DELIVERED");
            const href = `/customers/${order.customerId}/orders/${order.id}`;
            const suitCount = Math.max(1, order._count.items);
            return (
              <tr key={order.id} className="border-b border-rule/60 transition last:border-b-0 hover:bg-indigo/5">
                <td className={`p-0 ${isOverdue ? "border-l-4 border-l-amber" : ""}`}>
                  <Link href={href} className="block px-4 py-3 tabular-nums font-semibold text-ink">
                    {formatOrderNumber(order.orderNumber)}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={href} className="block px-3 py-3 font-medium text-graphite">
                    {order.customer.name}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={href} className="block px-3 py-3 tabular-nums text-graphite/70">
                    {order.customer.phonePrimary}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={href} className={`block px-3 py-3 tabular-nums ${isOverdue ? "font-semibold text-amber" : "text-graphite/70"}`}>
                    {order.deliveryDate ? formatDate(order.deliveryDate) : "—"}
                  </Link>
                </td>
                <td className="p-0">
                  <Link href={href} className="block px-3 py-3 text-right tabular-nums text-graphite">
                    {suitCount}
                  </Link>
                </td>
                <td className="p-0">
                  <Link
                    href={href}
                    className={`block px-3 py-3 text-right tabular-nums ${Number(order.balanceAmount) > 0 ? "font-medium text-amber" : "text-graphite/40"}`}
                  >
                    {formatMoney(order.balanceAmount)}
                  </Link>
                </td>
                <td className="px-3 py-2.5 pr-4">
                  <OrderStatusForm
                    customerId={order.customerId}
                    orderId={order.id}
                    status={order.status}
                    redirectTo={redirectTo}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-semibold ${className}`}>{children}</th>;
}
