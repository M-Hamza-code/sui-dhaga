import Link from "next/link";
import { BackupExportControls } from "@/components/backup/backup-export-controls";
import { SettingsMenu } from "@/components/settings-menu";
import { SyncStatusIndicator } from "@/components/offline/sync-status-indicator";
import { getSession } from "@/lib/auth";
import { en } from "@/lib/locale";

// Shared top bar for every authenticated page. Step 10 rebuild: the final
// design-system palette/typography, plus the Order Board / Settings nav
// items. Step 19 replaced the honest "not yet available" backup/export
// placeholders with the real BackupExportControls.
//
// Step 45 (Step 44 redesign plan) — this is the ONE shared component
// every authenticated page already renders, so extending it here is the
// smallest safe way to roll the new nav out consistently everywhere
// without touching any of its ~15 call sites or introducing a new
// AppShell/layout wrapper (a wider, riskier refactor deliberately left
// for a later step). Brand mark links to /overview (the new, separate
// Dashboard route) instead of /dashboard — /dashboard itself, its
// component, its redirects, and every keyboard shortcut that targets it
// are completely unchanged; this only moves what the LOGO itself links
// to.
//
// Step 51 — three further changes, all presentation/navigation only:
//   1. The nav's "Customers / Search" label is now just "Customers" —
//      same destination (/dashboard), /dashboard itself untouched.
//   2. The header's own search field (GlobalSearchBar) is removed
//      entirely — the customer search already living on /dashboard was
//      the only one that mattered; this was a second, redundant search
//      affordance. GlobalSearchBar's component file and its shared
//      useCustomerSearch hook (still used by /dashboard's own
//      search-home.tsx) are both untouched, just no longer rendered
//      here. `hideSearch` is kept as an accepted-but-now-inert prop
//      specifically so dashboard/page.tsx — which still passes it —
//      never needs to change.
//   3. The Settings nav item, the Admin/email readout, and the Logout
//      button are all replaced by one <SettingsMenu> — a small client
//      dropdown (Profile / Default Price / Setting / admin email /
//      Logout). getSession() is still called here for its own auth
//      guard exactly as before; only the email is passed down, never a
//      password or token.
//
// This component is now `async` (a Server Component) — every one of its
// ~15 current call sites is already a Server Component rendering it via
// plain JSX (`<PageHeader ... />`), which works identically whether the
// component is sync or async, so none of them needed to change.
export async function PageHeader({
  title,
  backHref,
  backLabel,
  hideSearch = false,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  // S1 (Search/Home) already has its own large, prominent search field as
  // the page's main content — showing the compact header dropdown too on
  // that one screen would be a redundant, confusing second search UI. Every
  // other page keeps the default (shown), completely unchanged.
  hideSearch?: boolean;
}) {
  const session = await getSession();

  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-rule bg-card px-6 py-3">
      <div className="flex items-baseline gap-3">
        <Link href="/overview" className="flex items-baseline gap-2">
          <span className="font-nastaliq text-xl leading-none text-ink" dir="rtl">
            {en.app.nameUrdu}
          </span>
          <span className="hidden whitespace-nowrap text-[10px] uppercase tracking-widest text-graphite/50 sm:inline">
            {en.app.tagline}
          </span>
        </Link>
        {backHref && (
          <Link
            href={backHref}
            className="whitespace-nowrap text-sm text-graphite/70 hover:text-ink hover:underline"
          >
            ← {backLabel ?? "Back"}
          </Link>
        )}
      </div>

      <nav className="flex items-center gap-1">
        <Link
          href="/overview"
          className="rounded-sm px-3 py-1.5 text-sm text-graphite transition hover:bg-paper hover:text-indigo"
        >
          {en.nav.dashboard}
        </Link>
        <Link
          href="/dashboard"
          className="rounded-sm px-3 py-1.5 text-sm text-graphite transition hover:bg-paper hover:text-indigo"
        >
          {en.nav.customersSearch}
        </Link>
        <Link
          href="/orders"
          className="rounded-sm px-3 py-1.5 text-sm text-graphite transition hover:bg-paper hover:text-indigo"
        >
          {en.nav.orderBoard}
        </Link>
      </nav>

      {/* Step 51 — the header's own search field is removed; hideSearch
          stays an accepted prop (see file header) but is now always a
          no-op, so dashboard/page.tsx never needed to change. */}

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-sm font-medium text-graphite/70 md:inline">{title}</span>

        {/* Real, working manual backup/export (Step 19) — hidden below lg
            for the same space reasons the old placeholders were. */}
        <div className="hidden lg:block">
          <BackupExportControls />
        </div>

        {/* Phase 7 — small sync-status pill + "Sync now", same header
            every authenticated page already renders (see this file's own
            Step 45 comment for why extending it here is the smallest
            safe way to roll it out everywhere). Renders nothing when
            IndexedDB isn't available (SSR-safe, same convention as
            CustomerIdentityCard etc.). */}
        <SyncStatusIndicator />

        {/* Step 51 — Settings icon + dropdown (Profile / Default Price /
            Setting / admin email / Logout), replacing the old separate
            Settings nav item, Admin readout, and Logout button. Session
            email only ever passed down; never a password or token. */}
        <SettingsMenu email={session?.email ?? null} />
      </div>
    </header>
  );
}
