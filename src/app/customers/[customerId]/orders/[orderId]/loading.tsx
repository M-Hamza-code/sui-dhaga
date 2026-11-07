import { PageSkeleton, SkeletonBar, SkeletonCard } from "@/components/ui/page-skeleton";

// Route-level loading UI for Order Detail — one deep Prisma query
// (customer + both design options + the default snapshot + every item
// with its own snapshot and pocket option). Shapes mirror
// [orderId]/page.tsx: the order/action card, then its section stack.
export default function Loading() {
  return (
    <PageSkeleton>
      <div className="rounded-sm border border-rule bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SkeletonBar w="w-24" h="h-7" />
            <SkeletonBar w="w-48" h="h-4" className="mt-2" />
          </div>
          <SkeletonBar w="w-28" h="h-8" />
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBar key={i} w="w-24" h="h-8" />
          ))}
        </div>
      </div>
      <div className="mt-6 space-y-6">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={6} />
        <SkeletonCard rows={3} />
      </div>
    </PageSkeleton>
  );
}
