import { redirect } from "next/navigation";

// Step 1's placeholder said "pages will be built in subsequent steps" —
// they all exist now, so that copy was stale and actively misleading.
// "/" itself isn't in middleware.ts's protected-prefix list, so this
// redirect is what routes a visitor to the real app: /dashboard is
// itself protected and sends an unauthenticated visitor on to /login,
// so this stays a single honest entry point rather than a second,
// competing landing screen.
export default function Home() {
  redirect("/dashboard");
}
