"use client";

// Compact header search dropdown (Step 4, rewired in Step 11 onto the new
// searchCustomers algorithm/result shape and the Step 10 design tokens).
// Debounce/fetch state comes from useCustomerSearch, shared with the S1
// Search/Home screen — this file only owns presentation. Read-only —
// never mutates data.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCustomerSearch } from "./use-customer-search";
import { en } from "@/lib/locale";

export function GlobalSearchBar({ className }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const { results, hasSearched, isPending } = useCustomerSearch(query);

  function goToCustomer(customerId: string) {
    setQuery("");
    setIsFocused(false);
    router.push(`/customers/${customerId}`);
  }

  const showDropdown = isFocused && query.trim().length > 0;

  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setIsFocused(true)}
        // Delayed so a click on a result (onMouseDown navigates first)
        // isn't lost to the dropdown closing on blur.
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        placeholder={en.search.placeholder}
        aria-label={en.search.ariaLabel}
        className="w-full rounded-sm border border-rule bg-card px-3 py-2 text-sm text-graphite focus:outline-none focus:ring-1 focus:ring-indigo"
        style={{ fontVariantNumeric: "tabular-nums" }}
      />

      {showDropdown && (
        <div className="absolute z-10 mt-1 w-full rounded-sm border border-rule bg-card text-sm">
          {isPending ? (
            <p className="px-4 py-3 text-graphite/60">{en.search.searching}</p>
          ) : results.length > 0 ? (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onMouseDown={() => goToCustomer(customer.id)}
                    className="block w-full px-4 py-2 text-left hover:bg-paper"
                  >
                    <div className="font-medium text-graphite">{customer.name}</div>
                    <div className="tabular-nums text-graphite/60">{customer.phonePrimary}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : hasSearched ? (
            <p className="px-4 py-3 text-graphite/60">{en.search.noResultsShort}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
