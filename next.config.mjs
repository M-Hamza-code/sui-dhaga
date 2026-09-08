/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
