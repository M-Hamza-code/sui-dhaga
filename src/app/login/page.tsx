import { login } from "@/lib/auth-actions";
import { en } from "@/lib/locale";

// Phase 1 has exactly one admin account and no public registration —
// there is deliberately no link to a signup page here. Deliberately no
// PageHeader either (Step 10's shared nav/search/logout bar makes no
// sense on a pre-auth screen) — the Nastaliq brand mark below is the
// same treatment PageHeader itself uses, just placed standalone here.
//
// Step 48 — presentation-only polish. The form itself (field names, ids,
// autocomplete, required, the `login` Server Action, the `?error=1`
// query-flag pattern) is byte-for-byte the same as before; only the
// surrounding visual treatment changed: a stronger brand moment above
// the card, a touch more elevation/definition on the card itself, and
// a small ink-colored top accent echoing the ledger-red brand ink used
// throughout the rest of the app. No new tokens, no gradients.
export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const hasError = searchParams?.error === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-8">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <span className="font-nastaliq text-4xl leading-none text-ink" dir="rtl">
            {en.app.nameUrdu}
          </span>
          <p className="mt-2 text-[11px] uppercase tracking-widest text-graphite/50">{en.app.tagline}</p>
          <p className="mt-4 text-sm text-graphite/60">{en.auth.signInSubtitle}</p>
        </div>

        <form
          action={login}
          className="mt-8 space-y-4 rounded-sm border border-rule border-t-4 border-t-ink bg-card p-6 shadow-sm"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-graphite">
              {en.auth.email}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2.5 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-graphite">
              {en.auth.password}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 block w-full rounded-sm border border-rule bg-paper px-3 py-2.5 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo"
            />
          </div>

          {hasError && (
            <p role="alert" className="rounded-sm border border-amber bg-amber/10 px-3 py-2 text-sm text-graphite">
              {en.auth.invalidCredentials}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-sm bg-indigo px-4 py-2.5 text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2"
          >
            {en.auth.loginButton}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-graphite/40">{en.app.tagline}</p>
      </div>
    </main>
  );
}
