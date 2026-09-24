"use client";

// Shared debounced-search state, used by both the compact header dropdown
// (GlobalSearchBar) and the S1 Search/Home screen (SearchHome) — both
// call the exact same searchCustomers Server Action; only presentation
// differs between the two.
//
// Phase 10 (§8/§11) — searchCustomers's rejection is caught instead of
// left unhandled (previously: `isPending` stuck true forever, or a raw
// unhandled-rejection). Phase 11 (§1) then went further: since the same
// customers/orders/measurements data the online search reads is
// already mirrored locally (Phase 2/3), a failed server search now
// falls back to searchCustomersLocally() — the SAME matching rules
// (customer-search-matching.ts), reading Dexie instead of Postgres —
// rather than only ever showing a "you're offline" dead end.
// `searchFailed` is now reserved for the (rare) case where BOTH the
// server call and the local fallback fail to produce a usable result.
//
// Step 56 (Issue 1) — the server half now calls /api/search/customers
// (a plain Route Handler) instead of invoking the searchCustomers()
// Server Action directly. See that route's own comment for exactly why:
// calling a Server Action from here was the actual root cause of the
// search input losing focus on every debounced search. Everything else
// in this hook — the debounce, the stale-response guard, the local
// fallback on failure — is unchanged.

import { useEffect, useRef, useState, useTransition } from "react";
import type { CustomerSearchResult } from "@/lib/customer-search";
import { searchCustomersLocally } from "@/lib/offline/customer-search-local";

// The route returns Date fields as JSON strings (there's no Date type
// on the wire); revive them back into real Dates right here so
// CustomerSearchResult's declared type holds everywhere downstream,
// same as it always did coming out of the Server Action.
type CustomerSearchResultJson = Omit<CustomerSearchResult, "lastOrderAt" | "measurementUpdatedAt"> & {
  lastOrderAt: string | null;
  measurementUpdatedAt: string | null;
};

async function fetchCustomerSearch(query: string): Promise<CustomerSearchResult[]> {
  const res = await fetch(`/api/search/customers?q=${encodeURIComponent(query)}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Search request failed (${res.status})`);
  }
  const data = (await res.json()) as { results: CustomerSearchResultJson[] };
  return data.results.map((r) => ({
    ...r,
    lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null,
    measurementUpdatedAt: r.measurementUpdatedAt ? new Date(r.measurementUpdatedAt) : null,
  }));
}

// Step 58 — raised from 300ms to ~2s on direct feedback: search was
// firing well before the admin finished typing a name. This only changes
// WHEN the search fires — the actual fetch still goes through
// fetchCustomerSearch() -> /api/search/customers (a plain Route Handler,
// not a Server Action), which is what keeps the input focused while
// typing (see that function's own comment / Step 56's fix); a longer
// delay doesn't reintroduce the old remount/focus-loss bug, since that
// was never a timing issue.
const DEBOUNCE_MS = 2000;

export function useCustomerSearch(query: string) {
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  // Phase 11 (§1) — true when `results` came from the local Dexie
  // fallback rather than the server, so the UI can honestly say so
  // (never presenting a possibly-incomplete local snapshot as if it
  // were confirmed against the server).
  const [isLocalResult, setIsLocalResult] = useState(false);
  const [isPending, startTransition] = useTransition();

  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  // Guards against an older, slower keystroke's response overwriting a
  // newer one's results.
  const latestRequestId = useRef(0);

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      // Never query the database for empty input.
      latestRequestId.current += 1;
      setResults([]);
      setHasSearched(false);
      setSearchFailed(false);
      setIsLocalResult(false);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      const requestId = ++latestRequestId.current;
      startTransition(async () => {
        try {
          const found = await fetchCustomerSearch(trimmed);
          if (requestId === latestRequestId.current) {
            setResults(found);
            setHasSearched(true);
            setSearchFailed(false);
            setIsLocalResult(false);
          }
        } catch (err) {
          if (requestId !== latestRequestId.current) return;
          console.error("[search] searchCustomers failed, falling back to local search", err);
          try {
            const localResults = await searchCustomersLocally(trimmed);
            if (requestId === latestRequestId.current) {
              setResults(localResults);
              setHasSearched(true);
              setSearchFailed(false);
              setIsLocalResult(true);
            }
          } catch (localErr) {
            if (requestId === latestRequestId.current) {
              console.error("[search] local fallback search also failed", localErr);
              setResults([]);
              setHasSearched(true);
              setSearchFailed(true);
              setIsLocalResult(false);
            }
          }
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query]);

  return { results, hasSearched, isPending, searchFailed, isLocalResult };
}
