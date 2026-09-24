import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Step 1's placeholder said "pages will be built in subsequent steps" —
// they all exist now, so that copy was stale and actively misleading.
// "/" itself isn't in middleware.ts's protected-prefix list, so this
// redirect is what routes a visitor to the real app.
//
// Step 50 — an authenticated visitor now lands on /overview (the real
// Dashboard), matching where a fresh login itself lands
// (auth-actions.ts). An unauthenticated visitor's path is completely
// unchanged: still routed through /dashboard, which is itself protected
// and sends them on to /login — this only adds a branch for the
// already-signed-in case, it doesn't touch the signed-out one at all.
export default async function Home() {
  const session = await getSession();
  redirect(session ? "/overview" : "/dashboard");
}
