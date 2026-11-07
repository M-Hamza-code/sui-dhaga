import { SkeletonBar } from "@/components/ui/page-skeleton";

// Route-level loading UI for S1 Search/Home. This one does NOT use
// PageSkeleton's max-w-5xl body: S1's own layout is a narrower
// max-w-3xl column with the search field at the top, so the skeleton
// matches that instead (same reasoning as every other loading.tsx here —
// mirror the real layout, never a generic spinner).
export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col bg-paper" aria-busy="true">
      <div className="flex items-center gap-4 border-b border-rule bg-card px-6 py-4">
        <SkeletonBar w="w-28" h="h-5" />
        <SkeletonBar w="w-48" h="h-4" />
        <span className="ml-auto" />
        <SkeletonBar w="w-24" h="h-6" />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 animate-pulse px-6 pt-12">
        <span className="sr-only" role="status">
          Loading…
        </span>
        <SkeletonBar w="w-full" h="h-14" />
        <div className="mt-3 flex items-center justify-between">
          <SkeletonBar w="w-48" h="h-9" />
          <SkeletonBar w="w-32" h="h-3" />
        </div>
        <div className="mt-6 border-t border-rule" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBar key={i} w={i % 3 === 2 ? "w-2/3" : "w-full"} />
          ))}
        </div>
      </div>
    </main>
  );
}
