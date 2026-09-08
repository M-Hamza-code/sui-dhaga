// Server-side helpers for reading the current admin session.
// For use in Server Components / Server Actions only (relies on
// `next/headers`, which is not available in middleware).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "@/lib/session";

/**
 * Returns the current session payload, or null if the visitor is not
 * authenticated (no cookie, expired token, or invalid signature).
 *
 * Route protection itself is enforced by middleware.ts — this is for
 * pages/actions that need to know *who* is logged in (e.g. to display
 * the admin's email, or stamp `createdById` on a record).
 */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE.name)?.value;
  return verifySessionToken(token);
}

/**
 * Same as getSession(), but redirects to /login if there is no valid
 * session. Use this at the top of Server Actions that mutate data — the
 * middleware already blocks unauthenticated page loads, but an action is
 * its own entry point and should not rely solely on the page that
 * happened to render its form.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
