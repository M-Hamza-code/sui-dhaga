// Step 56 (Issue 1) — root-cause fix for the search box losing focus
// while typing.
//
// THE PROBLEM: useCustomerSearch previously called searchCustomers()
// (customer-search.ts), a Next.js Server Action, directly from client
// code on every debounced keystroke. Invoking a Server Action from a
// Client Component makes Next.js re-fetch and reconcile the CURRENT
// ROUTE's RSC payload as part of that action's own response — a real,
// documented App Router behavior, not a bug in this app's own code —
// which is what was showing up as "the page refreshes and the input
// loses focus" roughly DEBOUNCE_MS after every keystroke (exactly when
// the debounced action call resolved).
//
// THE FIX: search is read-only and called very frequently from client
// code, so it belongs behind a plain Route Handler instead — an ordinary
// fetch() carries no RSC payload and triggers no route re-render at all,
// exactly like every existing /api/sync/* endpoint already proves for
// this app's other frequent client-to-server calls. The actual
// matching/query logic is NOT duplicated here — queryCustomers()
// (customer-search-query.ts) is the same code searchCustomers() (the
// Server Action, still kept, unchanged) also calls.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryCustomers } from "@/lib/customer-search-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await queryCustomers(q);
  return NextResponse.json({ results });
}
