"use client";

// Route-level error boundary. Before this file existed, an unexpected
// throw inside any page's Server Component (a dropped database
// connection being the realistic one here — every screen reads Postgres)
// surfaced as Next.js's raw error overlay in development and a blank
// unstyled page in production, with no way back into the app.
//
// `reset()` is Next's own retry: it re-renders the failed route segment,
// which re-runs that page's queries. For the dropped-connection case
// that's genuinely all that's needed, so it's offered first.
//
// Deliberately says nothing about WHAT failed beyond the digest: error
// messages from a Server Component can carry query/schema detail, and
// this screen is as reachable as any page. Nothing here touches the
// offline sync layer — anything the admin saved locally is still in
// IndexedDB and still queued, which is exactly what the second line
// says, honestly, rather than implying data was lost.
import Link from "next/link";
import { useEffect } from "react";
import { en } from "@/lib/locale";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server-side cause is already in the server log; this puts the
    // matching digest in the browser console so the two can be lined up.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-8">
      <div className="w-full max-w-md text-center">
        <span className="font-nastaliq text-3xl leading-none text-ink" dir="rtl">
          {en.app.nameUrdu}
        </span>

        <div className="mt-8 rounded-sm border border-amber bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-graphite">{en.errorPage.title}</h1>
          <p className="mt-2 text-sm text-graphite/60">{en.errorPage.description}</p>
          <p className="mt-2 text-sm text-graphite/60">{en.errorPage.dataSafe}</p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-sm bg-indigo px-5 py-2.5 text-sm text-white transition hover:bg-indigo-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-2"
            >
              {en.errorPage.tryAgain}
            </button>
            <Link
              href="/overview"
              className="rounded-sm border border-rule px-5 py-2.5 text-sm text-graphite transition hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-2"
            >
              {en.errorPage.goToDashboard}
            </Link>
          </div>

          {error.digest && (
            <p className="mt-5 border-t border-rule pt-4 text-xs text-graphite/40">
              {en.errorPage.referenceTemplate.replace("{digest}", error.digest)}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
