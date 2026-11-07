import Link from "next/link";

// A page's own contextual bar — now just the "← Back" link, when the
// page supplies one.
//
// WHAT MOVED OUT, AND WHY
//
// This used to be the entire application header: brand mark, tagline,
// three nav links, a page-title readout, Backup, Export, the sync pill
// and the settings menu, all in one undifferentiated flex row repeated
// on ~17 screens. Everything structural in that list now lives in
// AppShell's navigation rail (src/components/app-shell.tsx), mounted
// once in the root layout:
//   - brand mark, tagline, navigation              -> rail, top
//   - Backup / Export, sync status, settings menu  -> rail, foot
//   - the `title` readout                          -> removed entirely.
//     It duplicated the active nav item on /overview and /orders,
//     contradicted it on /dashboard (the readout said "Search" while
//     the nav said "Customers"), and every page already renders its
//     own <h1>.
//
// What remains is the one genuinely page-specific thing the header
// carried: where "back" goes, which only the page knows.
//
// BOTH PROPS ARE STILL ACCEPTED. `title` and `hideSearch` are inert,
// kept precisely so none of the ~17 call sites needed editing — the
// same convention `hideSearch` has followed since the header's own
// search field was removed in Step 51. Passing them is harmless.
//
// No longer async: it previously called getSession() for the settings
// menu's email, which the root layout now reads once and hands to
// AppShell instead.
export function PageHeader({
  title,
  backHref,
  backLabel,
  hideSearch = false,
}: {
  /** Inert — see this file's header. Accepted so existing call sites keep working. */
  title: string;
  backHref?: string;
  backLabel?: string;
  /** Inert — see this file's header. */
  hideSearch?: boolean;
}) {
  void title;
  void hideSearch;

  // A page with no back link gets no bar at all, so its content starts
  // at the top of the page area instead of under an empty strip.
  if (!backHref) {
    return null;
  }

  return (
    <div className="border-b border-rule/70 bg-card/50 px-6 py-2.5 print:hidden">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-graphite/70 transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1"
      >
        <span aria-hidden="true">←</span>
        {backLabel ?? "Back"}
      </Link>
    </div>
  );
}
