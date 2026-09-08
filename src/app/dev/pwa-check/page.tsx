"use client";

// Phase 8 — dev-only manual verification tool for the Service
// Worker/PWA setup, same reasoning and same "not part of the product"
// status as /dev/sync-check (Phase 3-7): not linked from any nav/
// header, not under any of middleware.ts's PROTECTED_PREFIXES.
//
// Why this exists: actual Service Worker installation, cache
// population, and offline navigation only happen inside a real
// browser's own Service Worker runtime — no headless browser tool
// exists in this environment (see the Phase 8 report). This page only
// ever READS the real browser APIs (navigator.serviceWorker,
// caches.*) — it does not register a second Service Worker, does not
// implement any caching logic of its own, and does not expose anything
// sensitive (no session tokens, no cookies, no queue payloads — just
// registration/cache-name/URL-list bookkeeping).
import { useState } from "react";

export default function PwaCheckPage() {
  const [log, setLog] = useState<string[]>([]);

  function append(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function checkRegistration() {
    setLog([]);
    if (!("serviceWorker" in navigator)) {
      append("navigator.serviceWorker is not available in this browser.");
      return;
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    append(`Registrations: ${registrations.length}`);
    for (const reg of registrations) {
      append(
        `- scope=${reg.scope} active=${reg.active?.scriptURL ?? "none"} waiting=${reg.waiting?.scriptURL ?? "none"} installing=${reg.installing?.scriptURL ?? "none"}`
      );
    }
    append(`navigator.serviceWorker.controller: ${navigator.serviceWorker.controller?.scriptURL ?? "none (this page not yet controlled)"}`);
  }

  async function checkCaches() {
    setLog([]);
    if (typeof caches === "undefined") {
      append("Cache Storage API is not available in this browser.");
      return;
    }
    const keys = await caches.keys();
    append(`Cache Storage buckets: ${keys.length}`);
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      append(`- "${key}" (${requests.length} entr${requests.length === 1 ? "y" : "ies"}):`);
      for (const req of requests) {
        append(`    ${req.url}`);
      }
    }
  }

  async function checkManifestAndIcons() {
    setLog([]);
    for (const url of ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/sw.js", "/offline"]) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        append(`${url} -> ${res.status} ${res.headers.get("content-type") ?? ""}`);
      } catch (err) {
        append(`${url} -> error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return (
    <main style={{ fontFamily: "monospace", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 18 }}>Phase 8 — PWA / Service Worker check</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        Dev-only verification tool. Not linked anywhere in the app. Reads real browser
        Service-Worker/Cache-Storage state only — registers nothing itself, contains no caching
        logic of its own. In development the app&apos;s own ServiceWorkerRegistration actively
        <em> unregisters</em> any Service Worker (see that component&apos;s comment), so
        &quot;Registrations: 0&quot; here while running <code>npm run dev</code> is expected. Run{" "}
        <code>npm run build &amp;&amp; npm start</code> and reload once to see a real registration.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <button onClick={checkRegistration} style={{ padding: "8px 16px", fontSize: 14 }}>
          Check Service Worker registration
        </button>
        <button onClick={checkCaches} style={{ padding: "8px 16px", fontSize: 14 }}>
          Inspect Cache Storage
        </button>
        <button onClick={checkManifestAndIcons} style={{ padding: "8px 16px", fontSize: 14 }}>
          Check manifest / icons / sw.js / offline page
        </button>
      </div>

      {log.length > 0 && (
        <pre style={{ marginTop: 20, background: "#f4f4f4", padding: 16, whiteSpace: "pre-wrap", fontSize: 13 }}>
          {log.join("\n")}
        </pre>
      )}
    </main>
  );
}
