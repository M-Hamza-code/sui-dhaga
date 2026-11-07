"use client";

// The application shell — a persistent navigation rail, replacing the
// single crowded header row every screen used to start with.
//
// WHY THIS EXISTS
//
// The old header packed brand mark, tagline, back link, three nav items,
// a page-title readout, Backup, Export, the sync pill and a settings
// icon into one undifferentiated flex row. Nothing was grouped, nothing
// had rank, and a rare admin action (Export) carried exactly as much
// visual weight as primary navigation. It also left the app looking like
// a generic CRUD template, despite having a real identity to work with.
//
// Moving navigation into a rail does three things at once:
//   1. Separates WHERE YOU ARE (rail) from WHAT YOU'RE DOING (page), so
//      the top of every screen belongs to the page's own content.
//   2. Gives the app's primary colour real presence. The brief's indigo
//      (#1F3A63) was previously a button fill and nothing more; at this
//      scale it anchors the layout and makes the warm paper content area
//      read as paper — the ledger feeling the Nastaliq mark and the
//      newsprint background were already reaching for.
//   3. Gives sync status and shop-level tools a permanent, sensible home
//      at the foot of the rail instead of competing with navigation.
//
// WHAT IT DOES NOT DO: no route changes, no data, no behaviour. Every
// destination is an existing href, and SyncStatusIndicator /
// BackupExportControls / SettingsMenu are the same components that were
// in the header, just relocated.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, LayoutDashboard, Users } from "lucide-react";
import { BackupExportControls } from "@/components/backup/backup-export-controls";
import { SettingsMenu } from "@/components/settings-menu";
import { SyncStatusIndicator } from "@/components/offline/sync-status-indicator";
import { en } from "@/lib/locale";

// Same three destinations, same hrefs, same ownership rules the previous
// header nav used — only the presentation differs. "Customers" owns
// /dashboard (S1 Search/Home) and every /customers/... screen, because
// that is the section you are in while on them.
const NAV = [
  { href: "/overview", label: en.nav.dashboard, Icon: LayoutDashboard, owns: ["/overview"] },
  { href: "/dashboard", label: en.nav.customersSearch, Icon: Users, owns: ["/dashboard", "/customers"] },
  { href: "/orders", label: en.nav.orderBoard, Icon: ClipboardList, owns: ["/orders"] },
] as const;

/**
 * Screens that must render with no app chrome at all.
 *
 * /login is pre-auth — a nav rail there would offer destinations that
 * immediately bounce back to /login. /offline is the Service Worker's
 * fallback page, shown precisely when navigation can't be trusted.
 */
const BARE_ROUTES = ["/login", "/offline"];

function isActive(pathname: string, owns: readonly string[]): boolean {
  return owns.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function AppShell({ email, children }: { email: string | null; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  if (BARE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return <>{children}</>;
  }

  return (
    // print:block so the rail collapses out of the printed page entirely
    // rather than leaving a column of empty space beside the receipt.
    <div className="lg:flex lg:min-h-screen print:block">
      {/* ── Navigation rail ──────────────────────────────────────────
          Below lg this is a horizontal bar across the top; from lg it
          becomes a fixed-width column. One component, one set of items —
          the breakpoint only changes the direction it flows. */}
      <nav
        aria-label={en.nav.primaryNavAriaLabel}
        className="sticky top-0 z-30 flex items-center gap-2 bg-indigo px-4 py-2.5 text-white/80 lg:static lg:h-auto lg:w-60 lg:flex-none lg:flex-col lg:items-stretch lg:gap-0 lg:px-0 lg:py-0 print:hidden"
      >
        {/* Brand. Nastaliq reversed out of the indigo — the mark finally
            sits on a surface with enough contrast to carry it. */}
        <Link
          href="/overview"
          className="hidden flex-none items-baseline gap-2 rounded-sm px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:flex lg:flex-col lg:items-start lg:gap-0 lg:border-b lg:border-white/10 lg:px-5 lg:pb-4 lg:pt-5"
        >
          <span
            className="hidden whitespace-nowrap font-nastaliq text-2xl leading-[1.7] text-white lg:inline"
            dir="rtl"
          >
            {en.app.nameUrdu}
          </span>
          <span className="hidden whitespace-nowrap text-[10px] uppercase tracking-widest text-white/45 lg:inline">
            {en.app.tagline}
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:mt-3 lg:flex-none lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible lg:px-3">
          {NAV.map(({ href, label, Icon, owns }) => {
            const active = isActive(pathname, owns);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                title={label}
                className={`flex flex-none items-center gap-2.5 whitespace-nowrap rounded-sm px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:flex-auto ${
                  active
                    ? "bg-white/15 font-medium text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
                <span className="hidden sm:inline lg:inline">{label}</span>
              </Link>
            );
          })}
        </div>

        {/* Shop-level tools. At the FOOT of the rail on wide screens:
            present on every screen, but never again competing with
            navigation for the same eye-line, which is what they did when
            they sat in the header row. */}
        <div className="ml-auto flex flex-none items-center gap-2 lg:ml-0 lg:mt-auto lg:flex-col lg:items-stretch lg:gap-2.5 lg:border-t lg:border-white/10 lg:px-4 lg:py-4">
          <div className="hidden lg:flex lg:gap-2">
            <BackupExportControls onDark />
          </div>
          {/* Sync state and the settings menu share a row at the foot:
              both are status/one-tap controls rather than destinations,
              and pairing them keeps the rail from ending in a ragged
              stack of single items. */}
          <div className="flex items-center gap-2">
            <SyncStatusIndicator onDark />
            <SettingsMenu email={email} onDark />
          </div>
        </div>
      </nav>

      {/* ── Page ─────────────────────────────────────────────────────
          min-w-0 matters: without it a wide table (the Order Board) would
          stretch this flex child instead of scrolling inside its own
          container, pushing the rail off screen. */}
      <div className="min-w-0 flex-1 bg-paper print:bg-white">{children}</div>
    </div>
  );
}
