import { PageSkeleton, SkeletonBar, SkeletonCard } from "@/components/ui/page-skeleton";

// Route-level loading UI for the Customer Profile. Shapes mirror
// [customerId]/page.tsx: the identity card (avatar circle + name/phone),
// then its 1fr/360px order-history + saved-measurements grid.
export default function Loading() {
  return (
    <PageSkeleton>
      <div className="rounded-sm border border-rule bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 flex-none rounded-full bg-rule/40" aria-hidden="true" />
          <div className="flex-1">
            <SkeletonBar w="w-56" h="h-7" />
            <SkeletonBar w="w-40" h="h-4" className="mt-2" />
          </div>
        </div>
        <div className="mt-5 flex gap-3 border-t border-rule pt-4">
          <SkeletonBar w="w-28" h="h-8" />
          <SkeletonBar w="w-28" h="h-8" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <SkeletonCard rows={5} />
        <SkeletonCard rows={8} />
      </div>
    </PageSkeleton>
  );
}
