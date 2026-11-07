"use client";

// S1 Search/Home (Step 11) — the main landing screen. Search is the
// screen: one field, autofocused, results inline below it (not a
// dropdown — this is the page's own content, not a header overlay).
// Shares its debounce/fetch state (useCustomerSearch) and its Server
// Action (searchCustomers) with the compact header dropdown; only the
// presentation differs, which is why this is a separate component rather
// than a second search system.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCustomerSearch } from "./use-customer-search";
import type { CustomerSearchResult } from "@/lib/customer-search-query";
import { formatRelativeTime } from "@/lib/format";
import { en } from "@/lib/locale";

export function SearchHome({ allCustomers }: { allCustomers: CustomerSearchResult[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const newCustomerRef = useRef<HTMLAnchorElement>(null);

  const [query, setQuery] = useState("");
  const { results, hasSearched, isSearching, searchFailed, isLocalResult, runSearchNow } =
    useCustomerSearch(query);
  // Phase 10 (§8/§11) — a failed search (most commonly: offline) is
  // its own distinct outcome, never folded into "no customers found".
  //
  // Gated on `isSearching` (debounce + request), which now actually
  // reports the wait — so "No customer found" can no longer appear over
  // a half-typed query while its search is still coming.
  const noResults = hasSearched && !isSearching && results.length === 0 && !searchFailed;

  // Autofocus on load. This local handler still covers "/" and Escape
  // while this screen itself is mounted and focused (Escape here also
  // clears the query, which is more specific than anything needed
  // globally). Step 21 added a separate root-level handler
  // (GlobalShortcuts) that reaches "/"/Escape from every other screen —
  // the two coexist without conflict; see that file's own comment.
  useEffect(() => {
    inputRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      const targetTag = (event.target as HTMLElement | null)?.tagName ?? "";
      const typingElsewhere = /input|select|textarea/i.test(targetTag) && event.target !== inputRef.current;

      if (event.key === "/" && !typingElsewhere) {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.key === "Escape" && event.target === inputRef.current) {
        setQuery("");
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setQuery]);

  // Once we know there are no results, focus "New customer" so Enter
  // starts a new record without reaching for the mouse.
  useEffect(() => {
    if (noResults) {
      newCustomerRef.current?.focus();
    }
  }, [noResults]);

  function goToCustomer(customerId: string) {
    router.push(`/customers/${customerId}`);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter opens the top result — but never acts on a stale result set
    // while a fresher keystroke's search is still pending. That guard
    // was always the intent; it only started working once isSearching
    // became honest. So that Enter isn't simply swallowed during the
    // 2s debounce, it now asks for the search immediately instead —
    // results arrive in the usual request time and a second Enter
    // opens the top one.
    if (isSearching) {
      runSearchNow();
      return;
    }
    if (results.length > 0) {
      goToCustomer(results[0].id);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 pt-12">
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          data-shortcut-target="s1-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={en.search.placeholder}
          aria-label={en.search.ariaLabel}
          className="w-full rounded-sm border border-indigo bg-card px-5 py-4 text-xl text-graphite focus:outline-none focus:ring-1 focus:ring-indigo"
          style={{ fontVariantNumeric: "tabular-nums" }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Step 32: two distinct, equally-reachable new-customer flows —
            the combined customer+order flow (Step 25, unchanged: same
            href, same primary styling, same position) stays the default,
            primary action; "Customer only" is new, secondary (a plain
            text link, not a filled button, so it reads as the less common
            path without competing for attention or requiring a new menu/
            popover pattern). */}
        <div className="flex items-center gap-4">
          <Link
            href="/customers/new/order"
            className="whitespace-nowrap rounded-sm bg-indigo px-4 py-2 text-sm text-white transition hover:bg-indigo-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-2"
          >
            {en.search.newCustomer}
          </Link>
          <Link
            href="/customers/new"
            className="whitespace-nowrap rounded-sm text-sm text-graphite/70 hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1"
          >
            {en.search.newCustomerOnly}
          </Link>
        </div>
        <span className="hidden text-xs text-graphite/50 sm:inline">{en.search.hint}</span>
      </div>

      <div className="mt-6 border-t border-rule" />

      {isSearching ? (
        // Reached from the first keystroke now, not just while the
        // request is open — `isSearching` covers the debounce wait too,
        // which is the part that used to look like nothing happening.
        // aria-live so the wait is announced rather than only drawn.
        <div className="flex items-center justify-center gap-2.5 py-10" role="status" aria-live="polite">
          <span
            className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-rule border-t-indigo"
            aria-hidden="true"
          />
          <span className="text-sm text-graphite/60">{en.search.searching}</span>
        </div>
      ) : searchFailed ? (
        // Phase 10 (§8/§11) — honest, distinct from "no customers
        // found": reached only when BOTH the server search AND the
        // Phase 11 local (Dexie) fallback below couldn't produce a
        // result (e.g. IndexedDB itself unavailable) — a genuinely rare
        // case. Creating a new customer below still works fully
        // offline regardless.
        <div className="py-12 text-center">
          <p className="text-sm text-graphite/60">Search needs an internet connection. Try again once you&apos;re back online.</p>
        </div>
      ) : results.length > 0 ? (
        <>
          {/* Phase 11 (§1) — the server search failed and these came
              from the local Dexie mirror instead: same matching rules,
              but this device's own last-synced snapshot, so it's said
              plainly rather than presented as if freshly confirmed
              against the server. */}
          {isLocalResult && (
            <p className="pt-3 text-xs text-graphite/50">Showing saved results from this device (offline).</p>
          )}
          <ul>
            {results.map((customer, index) => (
              // index === 0 marks the top result: Enter opens that one,
              // so its chevron is tinted to show which row that is.
              <CustomerRow key={customer.id} customer={customer} isTop={index === 0} onOpen={goToCustomer} />
            ))}
          </ul>
        </>
      ) : noResults ? (
        <div className="py-12 text-center">
          <p className="text-sm text-graphite/60">{en.search.noResults}</p>
          {/* Autofocus stays on the combined flow (brief §4: the empty
              state's New customer button opens S3 with a blank customer
              block, keyboard-only) — unchanged. "Customer only" is a
              smaller, non-autofocused secondary link underneath, for the
              admin who searched, found no one, and wants to just record
              the customer's details for now instead. */}
          <Link
            ref={newCustomerRef}
            href="/customers/new/order"
            className="mt-4 inline-block rounded-sm bg-indigo px-6 py-3 text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2"
          >
            {en.search.newCustomer}
          </Link>
          <Link href="/customers/new" className="mt-3 block text-sm text-graphite/70 hover:text-ink hover:underline">
            {en.search.newCustomerOnly}
          </Link>
        </div>
      ) : (
        // Idle state: every customer, A→Z.
        //
        // This used to be an "All Orders" list (Step 59), added purely to
        // fill space that otherwise rendered nothing. The side effect was
        // that this one screen showed ORDERS while idle and CUSTOMERS the
        // moment you typed — the thing on screen changed kind mid-
        // interaction. Search here matches customers (name, phone, or
        // customer ID) and the nav calls this screen "Customers", so the
        // idle list is customers too: typing now narrows the list already
        // in front of you instead of replacing it with a different sort
        // of thing.
        //
        // The all-orders view wasn't dropped — it moved to the Order
        // Board's own "All" tab, where orders belong.
        //
        // Rows are the SAME <CustomerRow> the search-results branch above
        // renders, from the same CustomerSearchResult shape, so the two
        // states cannot drift apart visually. The only difference is that
        // no row is marked "top result" here, because Enter has nothing
        // to open until a search has actually run.
        <div className="pt-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{en.search.allCustomers}</h2>
            <span className="text-xs text-graphite/50">{en.search.allCustomersHint}</span>
          </div>
          {allCustomers.length === 0 ? (
            <p className="mt-3 text-sm text-graphite/50">{en.search.allCustomersEmpty}</p>
          ) : (
            <ul className="mt-1">
              {allCustomers.map((customer) => (
                <CustomerRow key={customer.id} customer={customer} isTop={false} onOpen={goToCustomer} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One customer row — used by BOTH the idle "All Customers" list and the
 * search-results list, which is the whole point: the two states differ
 * only in which customers they contain, never in how a customer looks.
 *
 * This is the markup that was previously inlined in the search-results
 * branch, unchanged: the chevron, name, phone, last-order time, then the
 * customer ID / order count / measurement-age line underneath.
 *
 * `isTop` only tints the chevron to mark the row Enter would open. The
 * idle list passes false for every row — nothing is "the top result"
 * until a search has run.
 */
function CustomerRow({
  customer,
  isTop,
  onOpen,
}: {
  customer: CustomerSearchResult;
  isTop: boolean;
  onOpen: (customerId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(customer.id)}
        className="flex w-full items-start gap-4 border-b border-rule/60 px-1 py-3 text-left transition hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo"
      >
        <span className={`text-lg leading-7 ${isTop ? "text-indigo" : "text-rule"}`}>›</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-lg font-medium text-graphite">{customer.name}</span>
            <span className="tabular-nums text-base text-graphite">{customer.phonePrimary}</span>
            <span className="ml-auto text-sm text-graphite/60">
              {customer.lastOrderAt ? formatRelativeTime(customer.lastOrderAt) : en.search.noOrders}
            </span>
          </span>
          <span className="mt-0.5 block text-sm text-graphite/50">
            {/* The customer number (SD-000123) — readable straight off a
                row instead of having to open the profile. Null only for a
                customer created offline whose code the server hasn't
                assigned yet; said plainly rather than rendered as a blank
                or a fabricated number. */}
            <span className="tabular-nums text-graphite/70">
              {customer.customerCode ?? en.search.noCustomerCode}
            </span>
            {" · "}
            {customer.orderCount === 1
              ? en.search.oneOrder
              : en.search.orderCountTemplate.replace("{count}", String(customer.orderCount))}
            {" · "}
            {customer.measurementUpdatedAt
              ? en.search.measurementAgeTemplate.replace(
                  "{age}",
                  formatRelativeTime(customer.measurementUpdatedAt)
                )
              : en.search.noMeasurement}
          </span>
        </span>
      </button>
    </li>
  );
}
