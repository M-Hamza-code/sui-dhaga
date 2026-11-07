"use server";

// Server Actions for the single-admin login/logout flow. Phase 1 has no
// signup — this file intentionally exposes only `login` and `logout`.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";
import { checkLoginAllowed, clearLoginAttempts, recordFailedLogin } from "@/lib/login-throttle";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

// A password hash shaped like a real bcrypt hash but matching no real
// password. Compared against when the email doesn't exist, so login for a
// bad email takes the same time as login for a bad password — the response
// (and its timing) never reveals which one was wrong.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO0kFHhZTFHM0Tz3.J9Nyq9L2rY0oL5bC";

/**
 * Which bucket a login attempt is throttled under.
 *
 * Keyed on the client IP so one jammed source can't lock the real admin
 * out of their own shop. x-forwarded-for is the first entry (the original
 * client) when a proxy is in front; x-real-ip covers proxies that set
 * only that.
 *
 * When neither header is present the key falls back to a single shared
 * bucket, which means every attempt is counted together. That is a
 * deliberate fail-CLOSED choice: a missing IP must not become a way to
 * opt out of throttling. On a direct-to-Node deployment with no proxy
 * this makes the limit global rather than per-client — acceptable for a
 * one-account app, and it only ever errs toward refusing attempts.
 */
function throttleKey(): string {
  const h = headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown-client";
}

export async function login(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/login?error=1");
  }

  const { email, password } = parsed.data;
  const key = throttleKey();

  // Checked BEFORE any password work. A locked key never reaches
  // bcrypt.compare, so a lockout can't be probed through response
  // timing the way DUMMY_HASH above exists to prevent for a bad email.
  const gate = checkLoginAllowed(key);
  if (gate.locked) {
    redirect(`/login?error=locked&retryAfter=${gate.retryAfterMinutes}`);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordMatches) {
    const after = recordFailedLogin(key);
    // This failure was the one that tripped the limit — say so, instead
    // of a generic "invalid credentials" that leaves the admin guessing
    // why the next attempt is being refused.
    if (after.locked) {
      redirect(`/login?error=locked&retryAfter=${after.retryAfterMinutes}`);
    }
    redirect("/login?error=1");
  }

  // Successful login clears the counter, so a correct password always
  // resets the budget for this client.
  clearLoginAttempts(key);

  const token = await createSessionToken({ sub: user.id, email: user.email });

  cookies().set(SESSION_COOKIE.name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE.maxAge,
  });

  // Step 50 — a successful login now lands on the real Dashboard
  // (/overview), not S1 Search/Home. /dashboard itself is completely
  // unchanged and still fully reachable (nav link, "/" shortcut, Escape,
  // Ctrl+N with no customer context, the Quick Actions "Search Customer"
  // link) — only where a fresh login itself lands changed.
  redirect("/overview");
}

export async function logout(): Promise<void> {
  cookies().delete(SESSION_COOKIE.name);
  redirect("/login");
}
