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

import { useCallback, useEffect, useRef, useState } from "react";
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

// How long to wait after the last keystroke before searching.
//
// History, because this value has moved twice for real reasons:
//   300ms  — the original.
//   2000ms — Step 58, on direct feedback that search was firing before
//            the admin had finished typing a name.
//   600ms  — now. 2s turned out to be the ENTIRE perceived cost of
//            searching: measured server time for this endpoint is ~9ms
//            with one customer and 12-25ms with 500, so the timer was
//            over 99% of the wait. 600ms still waits for a genuine pause
//            in typing (so it does not fire mid-name, which is what the
//            2s was protecting against) while putting results on screen
//            in well under a second.
//
// This only ever changes WHEN the search fires. The fetch itself still
// goes through fetchCustomerSearch() -> /api/search/customers (a plain
// Route Handler, not a Server Action), which is what keeps the input
// focused while typing — see that function's own comment and Step 56's
// fix. Changing this delay cannot reintroduce the old remount/focus-loss
// bug, since that was never a timing issue.
//
// Enter does not wait for this at all: runSearchNow() below flushes the
// timer and searches immediately.
const DEBOUNCE_MS = 600;

// WHY THIS HOOK NO LONGER USES useTransition
//
// `isPending` used to come from React's useTransition, and the search
// was started as `startTransition(async () => { await fetch(...) })`.
// In React 18 startTransition does not track a promise returned by its
// callback — the transition is considered finished as soon as the
// callback's synchronous part returns, which for an async function is
// immediately, at the first await. So `isPending` flipped true and back
// to false within the same tick and the "Searching…" state this hook
// exists to report was effectively never observable. On top of that,
// nothing was pending at all during the DEBOUNCE_MS wait, which is the
// longest part of the whole interaction — so from the first keystroke
// the UI sat completely still for two seconds and then results simply
// appeared.
//
// Both are now reported explicitly:
//   - `isSearching` covers the entire time the typed query has no
//     answer yet: the debounce wait AND the request. This is what a
//     loading indicator should bind to.
//   - `isFetching` is narrower — true only while a request is actually
//     in flight. Kept separate because "don't act on a stale result
//     set" (the Enter-opens-top-result guard in SearchHome) is a
//     different question from "should a spinner show".
export function useCustomerSearch(query: string) {
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  // Set synchronously on the keystroke that schedules a search, cleared
  // only once that search has actually produced an outcome — so there
  // is no gap at the start where the UI looks idle.
  const [isDebouncing, setIsDebouncing] = useState(false);
  // Phase 11 (§1) — true when `results` came from the local Dexie
  // fallback rather than the server, so the UI can honestly say so
  // (never presenting a possibly-incomplete local snapshot as if it
  // were confirmed against the server).
  const [isLocalResult, setIsLocalResult] = useState(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  // Guards against an older, slower keystroke's response overwriting a
  // newer one's results.
  const latestRequestId = useRef(0);

  // The request itself, identical in behaviour to what used to live
  // inline inside the debounce timer (same stale-response guard, same
  // local-Dexie fallback on failure, same final searchFailed state).
  // It is a callback now only so the debounced timer below and
  // runSearchNow() can share one copy instead of two.
  const runSearch = useCallback(async (trimmed: string) => {
    const requestId = ++latestRequestId.current;
    setIsDebouncing(false);
    setIsFetching(true);
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
    } finally {
      // Only the newest request owns the flag — an older, slower
      // response resolving late must not clear a spinner that belongs
      // to a fresher keystroke still in flight.
      if (requestId === latestRequestId.current) {
        setIsFetching(false);
      }
    }
  }, []);

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
      setIsDebouncing(false);
      setIsFetching(false);
      return;
    }

    // Marked pending on this very keystroke, not DEBOUNCE_MS later —
    // this is the whole point of the fix. Anything already displayed is
    // now known to be stale with respect to what's typed.
    setIsDebouncing(true);

    debounceTimer.current = setTimeout(() => {
      void runSearch(trimmed);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query, runSearch]);

  /**
   * Run the pending search immediately instead of waiting out the rest
   * of DEBOUNCE_MS.
   *
   * DEBOUNCE_MS is 2s by deliberate choice (Step 58 raised it from
   * 300ms because search was firing before the admin had finished
   * typing a name), and that is left exactly as it is. But now that
   * `isSearching` is reported honestly, SearchHome's "Enter opens the
   * top result" guard correctly refuses to act during those 2s — which
   * on its own would make Enter feel dead. So Enter asks for the search
   * NOW rather than being ignored: results land in the usual request
   * time and a second Enter opens the top one. Enter never navigates
   * using a result set known to be stale.
   */
  const runSearchNow = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    void runSearch(trimmed);
  }, [query, runSearch]);

  return {
    results,
    hasSearched,
    searchFailed,
    isLocalResult,
    /** Debounce wait or request in flight — bind loading indicators to this. */
    isSearching: isDebouncing || isFetching,
    /** Request genuinely in flight. Narrower; see this hook's header. */
    isFetching,
    runSearchNow,
  };
}
