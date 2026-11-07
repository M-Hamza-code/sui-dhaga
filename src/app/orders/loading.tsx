import { PageSkeleton, SkeletonBar, SkeletonTable } from "@/components/ui/page-skeleton";

// Route-level loading UI for the Order Board — six count queries plus
// the row query. Shapes mirror orders/page.tsx: heading, the tab
// toolbar card, then the table.
export default function Loading() {
  return (
    <PageSkeleton>
      <SkeletonBar w="w-32" h="h-6" />
      <div className="mt-4 flex flex-wrap gap-1.5 rounded-sm border border-rule bg-card p-1.5 shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBar key={i} w="w-24" h="h-7" />
        ))}
      </div>
      <div className="mt-4">
        <SkeletonTable rows={7} />
      </div>
    </PageSkeleton>
  );
}
