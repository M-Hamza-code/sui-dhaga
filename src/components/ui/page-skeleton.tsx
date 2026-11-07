// Shared loading placeholder for the route-level loading.tsx files.
//
// Every real screen in this app is a Server Component running 2-8 Prisma
// queries before it can render anything (the Order Board alone runs six
// counts plus its row query). With no loading.tsx, Next.js shows the
// PREVIOUS page, frozen and still interactive-looking, for that whole
// time — on the shop's connection that reads as "the click didn't
// register", and the usual response is to click again.
//
// Deliberately NOT a spinner: these shapes match the real layout each
// route is about to render, so the page doesn't visibly jump when the
// data arrives. Presentation only — no data, no state, no logic.
//
// `animate-pulse` is Tailwind's own built-in utility; no new keyframes
// or config entries were added for this.

/** One grey bar. `w` is any Tailwind width class. */
export function SkeletonBar({ w = "w-full", h = "h-4", className = "" }: { w?: string; h?: string; className?: string }) {
  return <div className={`${h} ${w} rounded-sm bg-rule/40 ${className}`} aria-hidden="true" />;
}

/** The card-with-a-small-caps-title shape SectionCard renders. */
export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-sm border border-rule bg-card p-5 shadow-sm">
      <SkeletonBar w="w-32" h="h-3" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBar key={i} w={i % 3 === 2 ? "w-2/3" : "w-full"} />
        ))}
      </div>
    </div>
  );
}

/** The dense bordered table shape the Order Board / lists render. */
export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-sm border border-rule bg-card shadow-sm">
      <div className="border-b border-rule bg-paper px-4 py-3">
        <SkeletonBar w="w-40" h="h-3" />
      </div>
      <div className="divide-y divide-rule/60">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <SkeletonBar w="w-12" />
            <SkeletonBar w="w-40" />
            <span className="flex-1" />
            <SkeletonBar w="w-20" />
            <SkeletonBar w="w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The full page shell: the same bordered header strip PageHeader
 * occupies, then whatever skeleton body the route passes in. `aria-busy`
 * + a polite status role so a screen reader announces the wait instead
 * of reading a page full of empty boxes.
 */
export function PageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper" aria-busy="true">
      <div className="flex items-center gap-4 border-b border-rule bg-card px-6 py-4">
        <SkeletonBar w="w-28" h="h-5" />
        <SkeletonBar w="w-48" h="h-4" />
        <span className="ml-auto" />
        <SkeletonBar w="w-24" h="h-6" />
      </div>
      <div className="mx-auto max-w-5xl animate-pulse p-6">
        <span className="sr-only" role="status">
          Loading…
        </span>
        {children}
      </div>
    </main>
  );
}
