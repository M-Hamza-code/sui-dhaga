import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Noto_Naskh_Arabic, Noto_Nastaliq_Urdu } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { GlobalShortcuts } from "@/components/global-shortcuts";
import { en } from "@/lib/locale";
import { InitialSyncBootstrap } from "@/components/offline/initial-sync-bootstrap";
import { SyncQueueBootstrap } from "@/components/offline/sync-queue-bootstrap";
import { ServiceWorkerRegistration } from "@/components/offline/service-worker-registration";
import { getSession } from "@/lib/auth";
import "./globals.css";

// Step 10 — design-system typography foundation. All three are self-hosted
// by Next.js at build time (no runtime request to Google's font CDN),
// which also happens to suit the "internet unreliable" environment this
// app runs in. Each exposes a CSS variable that tailwind.config.ts's
// fontFamily tokens (sans / naskh / nastaliq) resolve through.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const notoNaskhArabic = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-naskh",
  display: "swap",
});

const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  weight: ["400", "700"],
  variable: "--font-nastaliq",
  display: "swap",
});

export const metadata: Metadata = {
  // A title TEMPLATE rather than one fixed string: every page now exports
  // its own short `title` (see each page.tsx) and lands here as
  // "<page> · Sui Dhaga". Before this, all ~20 screens shared the single
  // title below, so browser tabs, history entries, and — most visibly —
  // the browser's own printed page header on the Receipt/Work Order
  // routes all read the same generic text. `default` keeps that exact
  // original string for any page that exports no title of its own
  // (e.g. "/" itself, which only redirects), so nothing regresses.
  title: {
    default: "Sui Dhaga — Management System",
    template: "%s · Sui Dhaga",
  },
  description: "Internal customer, measurement, and order management for Sui Dhaga.",
  // Phase 8 (Part A) — manifest.ts's own file-convention wiring already
  // injects <link rel="manifest">; these two fields round out "required
  // metadata" for installability/iOS "Add to Home Screen" using the
  // exact same icon routes the manifest points at — no new icons.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Sui Dhaga" },
  icons: { apple: "/icon-512.png" },
};

// Phase 8 (Part A) — themeColor moved out of `metadata` into its own
// `viewport` export as of Next.js 14's Metadata API; same "indigo"
// design-system token manifest.ts uses, not a new color.
export const viewport: Viewport = {
  themeColor: "#1F3A63",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read once here instead of once per page. getSession() is the same
  // cheap signed-cookie read every page already performs for its own
  // auth guard; this adds no database work.
  const session = await getSession();
  return (
    <html lang="en" dir="ltr">
      <body
        className={`${ibmPlexSans.variable} ${notoNaskhArabic.variable} ${notoNastaliqUrdu.variable} bg-paper font-sans text-graphite antialiased`}
      >
        {/* Keyboard-only escape hatch past the header. Every
            authenticated screen renders PageHeader first (brand mark,
            back link, three nav items, backup/export, the sync pill,
            the settings menu), so reaching a page's actual content by
            Tab meant going through all of it on every single
            navigation. Invisible until focused — `sr-only` with a
            `focus:` override is the standard pattern, and it adds
            nothing to the visual design. Targets the <main> element
            wrapper below, which every page's own <main> then renders
            inside — one id in one file, rather than adding the same id
            to ~20 page components. tabIndex={-1} on that wrapper is
            what makes the jump move keyboard FOCUS and not just the
            scroll position (a plain <div> isn't focusable on its own,
            so Tab would otherwise resume from the header again). */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-indigo focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          {en.app.skipToContent}
        </a>
        {/* Step 21 — single global keyboard-shortcut listener, mounted
            once for the whole app. Renders nothing itself. */}
        <GlobalShortcuts />
        {/* Phase 3 (offline-first) — one-shot initial Server -> Local
            sync, mounted the same way as GlobalShortcuts above and for
            the same reason: a single non-visual client component that
            should run once per app load, not once per page. Renders
            nothing itself; see its own file for what it does. */}
        <InitialSyncBootstrap />
        {/* Phase 4 (offline-first) — starts the sync queue processor
            (recovers any interrupted "sending" item, drains anything
            pending) and listens for the browser's `online` event to
            re-attempt when connectivity returns. Same mount pattern as
            the two components above; renders nothing itself. */}
        <SyncQueueBootstrap />
        {/* Phase 8 — registers public/sw.js (production only; see that
            component's own comment for why not in development). Same
            mount pattern as the three components above; renders
            nothing itself. */}
        <ServiceWorkerRegistration />
        {/* AppShell supplies the persistent navigation rail for every
            authenticated screen (and renders nothing but its children on
            /login and /offline). It's mounted here, once, rather than in
            each page, so no page component had to change. The session
            email is read in this Server Component and passed down — the
            same single value PageHeader used to read for SettingsMenu;
            never a password or token. */}
        <AppShell email={session?.email ?? null}>
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
        </AppShell>
      </body>
    </html>
  );
}
