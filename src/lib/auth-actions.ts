"use server";

// Server Actions for the single-admin login/logout flow. Phase 1 has no
// signup — this file intentionally exposes only `login` and `logout`.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

// A password hash shaped like a real bcrypt hash but matching no real
// password. Compared against when the email doesn't exist, so login for a
// bad email takes the same time as login for a bad password — the response
// (and its timing) never reveals which one was wrong.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO0kFHhZTFHM0Tz3.J9Nyq9L2rY0oL5bC";

export async function login(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/login?error=1");
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordMatches) {
    redirect("/login?error=1");
  }

  const token = await createSessionToken({ sub: user.id, email: user.email });

  cookies().set(SESSION_COOKIE.name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE.maxAge,
  });

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  cookies().delete(SESSION_COOKIE.name);
  redirect("/login");
}
