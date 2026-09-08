import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Noto_Naskh_Arabic, Noto_Nastaliq_Urdu } from "next/font/google";
import { GlobalShortcuts } from "@/components/global-shortcuts";
import { InitialSyncBootstrap } from "@/components/offline/initial-sync-bootstrap";
import { SyncQueueBootstrap } from "@/components/offline/sync-queue-bootstrap";
import { ServiceWorkerRegistration } from "@/components/offline/service-worker-registration";
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
  title: "Sui Dhaga — Management System",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr">
      <body
        className={`${ibmPlexSans.variable} ${notoNaskhArabic.variable} ${notoNastaliqUrdu.variable} bg-paper font-sans text-graphite antialiased`}
      >
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
        {children}
      </body>
    </html>
  );
}
