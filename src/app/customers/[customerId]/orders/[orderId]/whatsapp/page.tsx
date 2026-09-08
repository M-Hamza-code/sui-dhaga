import { notFound } from "next/navigation";
import { getOrderPrintData } from "@/lib/order-print-data";
import { resolveWhatsAppPhone } from "@/lib/phone";
import { getDefaultWhatsAppTemplate } from "@/lib/whatsapp";
import { WhatsAppComposer } from "@/components/whatsapp/whatsapp-composer";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatMoney, formatOrderNumber } from "@/lib/format";
import { en } from "@/lib/locale";

// WhatsApp message preview/selection (Step 17). Reuses getOrderPrintData
// (Step 16) for the exact same cross-customer safety check, soft-deleted-
// customer behaviour, and ShopSettings lookup the receipt/work-order
// pages already use — a fourth near-identical loader was not worth
// writing. Order money/date fields are formatted here, server-side, with
// the existing formatMoney()/formatDate()/formatOrderNumber() helpers —
// never re-implemented — before being handed to the client composer as
// plain strings.
export default async function WhatsAppPage({
  params,
}: {
  params: { customerId: string; orderId: string };
}) {
  const data = await getOrderPrintData(params.customerId, params.orderId);
  if (!data) {
    notFound();
  }

  const { order, shopSettings } = data;
  const customer = order.customer;
  const orderHref = `/customers/${customer.id}/orders/${order.id}`;
  const phone = resolveWhatsAppPhone(customer);

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.whatsapp.pageTitle} backHref={orderHref} backLabel={en.print.backToOrder} />

      <PageContainer size="md">
        <h1 className="text-xl font-semibold text-graphite">{en.whatsapp.pageTitle}</h1>
        <p className="mt-1 text-sm text-graphite/60">
          {customer.name} · {formatOrderNumber(order.orderNumber)}
        </p>

        <div className="mt-6">
          {!phone ? (
            // Honest unavailable state (Part 4) — no button, no broken
            // link. phonePrimary is required at the schema level, but a
            // stored value like "021-1234567" (a landline, or anything
            // that doesn't normalize to a 10-digit mobile number) still
            // must not produce a fake/invalid wa.me link.
            <EmptyState title={en.whatsapp.unavailableTitle} description={en.whatsapp.unavailableHint} />
          ) : (
            <WhatsAppComposer
              phone={phone}
              defaultTemplate={getDefaultWhatsAppTemplate(order.status, order.deliveryDate)}
              data={{
                customerName: customer.name,
                shopName: shopSettings?.name || en.app.name,
                shopAddress: shopSettings?.address || null,
                shopPhone: shopSettings?.phone || null,
                orderNumberDisplay: formatOrderNumber(order.orderNumber),
                orderDateFormatted: formatDate(order.orderDate),
                deliveryDateFormatted: order.deliveryDate ? formatDate(order.deliveryDate) : null,
                totalFormatted: formatMoney(order.totalAmount),
                advanceFormatted: formatMoney(order.advanceAmount),
                balanceFormatted: formatMoney(order.balanceAmount),
                balanceIsZero: Number(order.balanceAmount) === 0,
              }}
            />
          )}
        </div>
      </PageContainer>
    </main>
  );
}
