/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets scripts/run-tests.mjs's spawned `next dev` (its own isolated test
  // server, a separate port) build into its OWN folder instead of the
  // plain `.next` the real dev server also writes into. Without this, a
  // test run that overlaps with `npm run dev` corrupts the shared chunk
  // manifest and throws a ChunkLoadError in the browser — confirmed to
  // happen more than once. Unset for every normal `next dev`/`next build`
  // (including CI/production), so nothing changes there.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Phase 12 (Production Configuration Audit / §1 Security) — baseline
  // security response headers. Purely additive: these change nothing
  // about how the app behaves or renders, only what a browser is told
  // to do with the response. No existing route/page/API needed any of
  // these to already work, so nothing here can regress Phase 1-11
  // functionality.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // This app never needs to be framed by another site —
          // blocks clickjacking (a malicious page framing /login or an
          // authenticated page over top of a fake UI).
          { key: "X-Frame-Options", value: "DENY" },
          // Stops the browser from trying to guess a response's
          // content type differently from what the server declared.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Avoids leaking this app's internal URLs (customer/order
          // ids in the path) to a third-party site via the Referer
          // header on an outbound link/asset request.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
