import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { formatOrderNumber } from "@/lib/format";
import { en } from "@/lib/locale";

// S5 Print Preview (Step 29) — the authoritative design brief/mockup's
// required post-save destination: "Order N saved" + Print / Send on
// WhatsApp / Back to search (design-brief §4 primary flow, mockup's own
// S5 section). Every save (order-actions.ts's createOrder and
// customer-order-actions.ts's createCustomerAndOrder, via the shared
// order-navigation.ts helper) now lands here.
//
// Reuses every existing piece rather than rebuilding any of them:
//   - Receipt and Work Order themselves are completely untouched; this
//     screen only links to their existing preview routes (Step 16/22/23),
//     each of which already has its own correct @page CSS and its own
//     Print button. Merging both documents' print rulesets into one print
//     job on this page would mean reconciling Work Order's A4-landscape
//     @page with Receipt's portrait/quarter-page @page in a single
//     browser print — the Step 27 audit and this step's own brief both
//     flag that as unsafe, so it is deliberately not attempted. Both
//     documents are still "visibly represented" here, as their own cards.
//   - WhatsApp reuses its existing composer route (Step 17) unchanged.
//   - Order Detail (unchanged — still required for S2/S4 navigation and
//     full historical lookup) is one click away via "View full order",
//     for anyone who wants the full design/payment breakdown this screen
//     deliberately doesn't repeat.
//
// Ownership check is the same rule every other order route already uses:
// an order that exists but under a different customer's path in the URL
// is treated exactly like a nonexistent order — see order-detail's own
// page for the identical check.
//
// Step 48 — presentation-only. The confirmation heading now carries a
// small success-toned checkmark badge (the same `success` token the
// Dashboard's Ready stat uses) instead of being plain text — a genuine
// positive-confirmation moment, not decoration implying anything new
// happened. The two DocumentCards are restyled to read as distinct
// physical documents (a plain-ink "for the workshop" card vs. an
// indigo-accented "for the customer" card, with a torn/perforated-edge
// cue on the receipt) rather than two identical generic boxes — same
// routes, same links, same descriptions.

export default async function PrintPreviewPage({
  params,
  searchParams,
}: {
  params: { customerId: string; orderId: string };
  searchParams: { whatsapp?: string };
}) {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: {
      customerId: true,
      orderNumber: true,
      customer: { select: { name: true, phonePrimary: true, deletedAt: true } },
    },
  });

  if (!order || order.customerId !== params.customerId) {
    notFound();
  }

  const { customerId, customer } = order;

  // Step 24's "Send on WhatsApp" checkbox, carried through as a query flag
  // (order-navigation.ts) rather than an automatic redirect away from this
  // required screen — see that file's comment for the full reasoning. It
  // only changes which action below is presented as primary; every action
  // stays reachable regardless.
  const wasMarkedForWhatsApp = searchParams?.whatsapp === "1";

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.orderDetail.heading} backHref="/dashboard" backLabel={en.printPreview.backToSearch} />

      <PageContainer size="lg">
        <div className="flex items-start gap-3 border-b-2 border-ink pb-3">
          <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-success text-sm text-white">
            ✓
          </span>
          <div>
            <p className="text-2xl font-semibold text-graphite">
              {en.printPreview.savedHeadingTemplate.replace("{no}", formatOrderNumber(order.orderNumber))}
            </p>
            <p className="mt-1 text-sm text-graphite/60">
              {customer.name} · <span className="tabular-nums">{customer.phonePrimary}</span>
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-graphite/70">{en.printPreview.subheading}</p>

        {/* Print — both existing documents, each opened through its own
            existing preview route. See file header for why these are not
            merged into a single print job. */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DocumentCard
            variant="workOrder"
            title={en.printPreview.workOrderTitle}
            description={en.printPreview.workOrderDescription}
            href={`/customers/${customerId}/orders/${params.orderId}/work-order`}
            linkLabel={en.print.workOrder.linkLabel}
          />
          <DocumentCard
            variant="receipt"
            title={en.printPreview.receiptTitle}
            description={en.printPreview.receiptDescription}
            href={`/customers/${customerId}/orders/${params.orderId}/receipt`}
            linkLabel={en.print.receipt.linkLabel}
          />
        </div>

        {/* Send on WhatsApp — reuses the existing composer route (Step 17)
            unchanged. Styled/focused as the primary action when the order
            form's checkbox was checked at save time. */}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
          <Link
            href={`/customers/${customerId}/orders/${params.orderId}/whatsapp`}
            autoFocus={wasMarkedForWhatsApp}
            className={
              wasMarkedForWhatsApp
                ? "rounded-sm bg-indigo px-5 py-2.5 text-sm text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2"
                : "rounded-sm border border-rule px-5 py-2.5 text-sm text-graphite transition hover:bg-card"
            }
          >
            {en.orderForm.sendOnWhatsApp}
          </Link>
          {wasMarkedForWhatsApp && <span className="text-xs text-amber">{en.printPreview.readyToSendHint}</span>}

          <span className="flex-1" />

          <Link
            href={`/customers/${customerId}/orders/${params.orderId}`}
            className="text-sm text-graphite/70 hover:text-ink hover:underline"
          >
            {en.printPreview.viewOrderDetail}
          </Link>
          <Link
            href="/dashboard"
            className="rounded-sm border border-rule px-5 py-2.5 text-sm text-graphite transition hover:bg-card"
          >
            {en.printPreview.backToSearch}
          </Link>
        </div>

        {customer.deletedAt && <p className="mt-6 text-sm text-graphite/50">{en.profile.deletedNotice}</p>}
      </PageContainer>
    </main>
  );
}

// Two document "kinds" get two distinct, restrained treatments so the
// pair reads as two different physical documents rather than two
// identical boxes — a plain ink-accented card for the workshop's Work
// Order, an indigo-accented card with a perforated-edge cue (dashed
// rule, echoing a tear-off receipt stub) for the customer's Receipt.
// Purely visual: both still link to their own existing, unmodified
// preview routes.
function DocumentCard({
  variant,
  title,
  description,
  href,
  linkLabel,
}: {
  variant: "workOrder" | "receipt";
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  const accent = variant === "workOrder" ? "border-t-ink" : "border-t-indigo";
  return (
    <div className={`flex flex-col justify-between rounded-sm border border-rule border-t-4 ${accent} bg-card p-5 shadow-sm`}>
      <div>
        <h2 className="text-sm font-semibold text-graphite">{title}</h2>
        <p className="mt-1 text-xs text-graphite/60">{description}</p>
      </div>
      {variant === "receipt" && <div className="my-3 border-t border-dashed border-rule" aria-hidden="true" />}
      <Link
        href={href}
        className={`mt-4 inline-block rounded-sm px-4 py-2 text-center text-sm text-white transition ${
          variant === "workOrder" ? "bg-ink hover:bg-ink/90" : "bg-indigo hover:bg-indigo-hover"
        }`}
      >
        {linkLabel}
      </Link>
    </div>
  );
}
