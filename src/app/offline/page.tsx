import { SyncStatusIndicator } from "@/components/offline/sync-status-indicator";

// Phase 8 (Part D/F/K) — the Service Worker's (public/sw.js) offline
// navigation fallback. Served from Cache Storage, entirely client-side,
// whenever a real navigation fails because the browser has no network —
// see sw.js's own comment for exactly when.
//
// Deliberately a plain, static page: no getSession()/cookies read (so
// Next prerenders it at build time, same as any other static asset —
// required for the Service Worker to safely precache it during
// install), no PageHeader (which needs a session), and no fabricated
// business data — just an honest, on-brand explanation plus the
// EXISTING Phase 7 sync-status indicator (Part K: reuse it, don't
// build a second one — SyncStatusIndicator needs no session/props, so
// it works standalone here exactly as it does inside PageHeader).
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
      <div className="w-full max-w-sm rounded-sm border border-rule bg-card p-8 shadow-sm">
        <p className="font-nastaliq text-2xl text-ink" dir="rtl">
          سوئی دھاگہ
        </p>
        <h1 className="mt-4 text-lg font-semibold text-graphite">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-graphite/70">
          This page needs an internet connection to open for the first time. Anything you already
          saved on this device is safe and will sync automatically once you&apos;re back online.
        </p>

        <div className="mt-5 flex justify-center">
          <SyncStatusIndicator />
        </div>

        <a
          href="/dashboard"
          className="mt-5 block w-full rounded-sm bg-indigo px-4 py-2.5 text-sm text-white transition hover:bg-indigo-hover"
        >
          Try again
        </a>
      </div>
    </main>
  );
}
