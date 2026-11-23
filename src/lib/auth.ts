// Server-side helpers for reading the current admin session.
// For use in Server Components / Server Actions only (relies on
// `next/headers`, which is not available in middleware).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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

async function userIsAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === "ADMIN";
}

/**
 * Backup/Restore authorization. Deliberately distinct from
 * requireSession(): a valid signed session proves "this request is
 * someone who logged in", never "this request is allowed to restore
 * the entire database" — those are different questions, and conflating
 * them was the gap the approved Backup & Restore design explicitly
 * flagged. Use this (not requireSession()) at the top of every Server
 * Action that can read, upload, validate, or apply a restore.
 *
 * Redirects (same as requireSession()) rather than returning an error
 * value — correct for a Server Action, wrong for a JSON Route Handler;
 * see getAdminSession() below for that case.
 */
export async function requireAdminSession(): Promise<SessionPayload> {
  const session = await requireSession();
  if (!(await userIsAdmin(session.sub))) {
    redirect("/dashboard");
  }
  return session;
}

/**
 * Same authorization as requireAdminSession(), but for a Route Handler
 * (the upload endpoint): never redirects, just returns null so the
 * caller can respond with its own 401/403 JSON — the same reasoning
 * every existing /api/sync/* route already applies by using
 * getSession() instead of requireSession().
 */
export async function getAdminSession(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  if (!(await userIsAdmin(session.sub))) return null;
  return session;
}
