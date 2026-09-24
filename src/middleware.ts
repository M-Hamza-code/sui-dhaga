import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Phase 1 route protection: everything under /dashboard requires a valid
// admin session; /login is only for signed-out visitors. Add new protected
// prefixes here as later steps introduce more application routes.
//
// Step 45 adds /overview (the new Dashboard placeholder route) to this
// list. /dashboard itself, and its own redirect below (an already-
// authenticated visitor hitting /login still lands on /dashboard, i.e.
// Search — unchanged), are both untouched.
//
// Phase 12 (Production Configuration Audit / §15) adds /dev — the
// unlinked manual-verification pages (/dev/sync-check,
// /dev/offline-db-check, /dev/pwa-check, Phase 2-11) were previously
// reachable by anyone who knew/guessed the URL, with no auth check of
// their own (they're plain client components, not Server Components
// calling getSession()). None of their buttons can actually mutate
// server data without a valid session anyway (every real write already
// goes through an auth-checked endpoint), but there's no reason a
// diagnostic tool needs to be loadable at all by a signed-out visitor —
// this brings it in line with how every other real page in the app
// already behaves, with zero effect on its intended use (a logged-in
// admin doing manual verification).
const PROTECTED_PREFIXES = ["/dashboard", "/overview", "/customers", "/orders", "/settings", "/dev"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE.name)?.value;
  const session = await verifySessionToken(token);

  if (isProtectedPath(pathname) && !session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Step 50 — an already-authenticated visitor hitting /login (e.g. a
  // stale bookmark, or opening it in a second tab while signed in) now
  // lands on /overview too, matching the fresh-login destination
  // (auth-actions.ts). Every other already-authenticated-visitor path
  // (a bookmarked /dashboard, a bookmarked /customers/... URL, etc.)
  // still lands exactly where its own URL says, unchanged.
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/overview/:path*", "/customers/:path*", "/orders/:path*", "/settings/:path*", "/dev/:path*", "/login"],
};
