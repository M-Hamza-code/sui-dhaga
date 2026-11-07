import Link from "next/link";
import { en } from "@/lib/locale";

// Branded 404. Before this file existed, notFound() — called by the
// order detail page's own ownership check (an order id that doesn't
// exist, or belongs to a different customer) and by any mistyped URL —
// fell through to Next.js's built-in default: unstyled black-on-white
// system text, no nav, and no way back into the app except the browser
// button.
//
// Deliberately NOT rendering PageHeader: this route is reachable while
// signed out (a mistyped URL outside middleware's protected prefixes),
// and PageHeader is an async Server Component that reads the session.
// The standalone Nastaliq brand mark is the same treatment the login
// screen already uses for exactly that reason.
//
// Both links are existing, unchanged routes. For a signed-out visitor
// middleware simply redirects them on to /login, as it already does for
// any protected path.
//
// KNOWN TRADEOFF (Next.js 14.2.15) — accepted deliberately, not an
// oversight. The existence of this file changes the HTTP STATUS of a
// notFound() call made from inside a route segment: an unmatched URL
// (/typo) still correctly returns 404, but the seven notFound() call
// sites on the order routes (a deleted order, or an order id belonging
// to a different customer — the ownership check) now return 200 with
// this page's body, where before they returned 404 with Next's own
// built-in unstyled page. Verified in both `next dev` and a production
// `next build && next start`; adding a segment-level not-found.tsx
// alongside the page does not restore the status either.
//
// Kept because this app is single-admin and entirely behind
// middleware.ts — there is no crawler, no SEO surface, and no API
// consumer reading that status, while the case it improves is a real
// daily one: an order can be deleted, so a printed work order or a
// bookmarked order link genuinely does go stale, and landing on raw
// black-on-white system text with no way back into the app is the
// worse outcome. If a correct status ever matters more than this page,
// deleting this one file restores the original behavior exactly.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-8">
      <div className="w-full max-w-md text-center">
        <span className="font-nastaliq text-3xl leading-none text-ink" dir="rtl">
          {en.app.nameUrdu}
        </span>

        <div className="mt-8 rounded-sm border border-rule border-t-4 border-t-ink bg-card p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-graphite/50">
            {en.notFound.code}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-graphite">{en.notFound.title}</h1>
          <p className="mt-2 text-sm text-graphite/60">{en.notFound.description}</p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/overview"
              className="rounded-sm bg-indigo px-5 py-2.5 text-sm text-white transition hover:bg-indigo-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-2"
            >
              {en.notFound.goToDashboard}
            </Link>
            <Link
              href="/dashboard"
              className="rounded-sm border border-rule px-5 py-2.5 text-sm text-graphite transition hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-2"
            >
              {en.notFound.searchCustomers}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
