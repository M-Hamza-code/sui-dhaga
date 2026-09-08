import type { MetadataRoute } from "next";

// Phase 8 (Part A) — Next.js's own App Router file convention: this
// file is automatically served at /manifest.webmanifest and Next
// automatically injects the <link rel="manifest"> tag into every
// page's <head> — no change to layout.tsx needed for that wiring.
//
// Values reuse the app's EXISTING branding rather than inventing new
// ones: name/description match layout.tsx's own <Metadata>, theme_color
// is the exact "indigo" design-system token (tailwind.config.ts),
// background_color is the exact "paper" token, and start_url is the
// app's own existing single entry point (see src/app/page.tsx's
// redirect — this is not a new landing screen, just where the already-
// existing redirect already sends every visitor).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sui Dhaga — Management System",
    short_name: "Sui Dhaga",
    description: "Internal customer, measurement, and order management for Sui Dhaga.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#FBF7F0",
    theme_color: "#1F3A63",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
