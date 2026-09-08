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

import { useEffect, useRef, useState, useTransition } from "react";
import { searchCustomers, type CustomerSearchResult } from "@/lib/customer-search";
import { searchCustomersLocally } from "@/lib/offline/customer-search-local";

const DEBOUNCE_MS = 300;

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
          const found = await searchCustomers(trimmed);
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
