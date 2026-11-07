import { PageSkeleton, SkeletonBar, SkeletonCard } from "@/components/ui/page-skeleton";

// Route-level loading UI for the Dashboard. Shown automatically by Next
// while this route's own Server Component runs its seven Prisma queries.
// Shapes mirror overview/page.tsx's real layout (stats row, Quick
// Actions, then the 1fr/340px recent-activity grid) so nothing jumps
// when the data lands.
export default function Loading() {
  return (
    <PageSkeleton>
      <SkeletonBar w="w-64" h="h-6" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-sm border border-rule bg-card p-4 shadow-sm">
            <SkeletonBar w="w-20" h="h-3" />
            <SkeletonBar w="w-16" h="h-7" className="mt-2" />
          </div>
        ))}
      </div>
      <div className="mt-6">
        <SkeletonCard rows={1} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <SkeletonCard rows={6} />
        <SkeletonCard rows={4} />
      </div>
    </PageSkeleton>
  );
}
