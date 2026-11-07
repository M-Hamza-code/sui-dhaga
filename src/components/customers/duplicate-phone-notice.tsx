"use client";

// Warns — never blocks — when the phone number being typed into a
// new-customer form already belongs to someone.
//
// WHY: nothing in the create path checked for this. `phonePrimary` is
// indexed but not unique, and every "duplicate" guard in customer-sync.ts
// / customer-actions.ts is an idempotency check BY ID (so a retried sync
// doesn't double-insert the same row) — none of them look at the phone.
// So the same walk-in customer entered twice produced two records, two
// measurement sets, and order history split across both, with nothing
// said at the counter.
//
// WHY A WARNING AND NOT A HARD BLOCK: a shared phone is legitimate. A
// household, a shop landline, a son booking for his father — all real,
// all common. Refusing the save would make the app wrong in those cases.
// This surfaces the existing customer and lets the admin decide: open
// that record instead, or carry on and create a second one.
//
// Works offline. It reuses the app's existing customer search rather than
// adding a second lookup: /api/search/customers already matches on phone
// (its phone branch triggers whenever the query starts with a digit or
// "+"), and searchCustomersLocally() applies the SAME matching rules to
// the Dexie mirror when the request fails — the same two-tier arrangement
// useCustomerSearch already relies on.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { CustomerSearchResult } from "@/lib/customer-search-query";
import { searchCustomersLocally } from "@/lib/offline/customer-search-local";
import { normalizePhoneDigits } from "@/lib/phone";
import { en } from "@/lib/locale";

/**
 * Digits required before anything is looked up.
 *
 * The search's phone branch does SUBSTRING matching, so a short query
 * ("0301") matches almost every number in the book and would cry wolf on
 * the fourth keystroke of every single customer. At 10+ digits a
 * substring hit is effectively an exact match on a full local mobile
 * number, which is the only point at which "this is the same person" is
 * a claim worth making.
 *
 * The tradeoff is deliberate: this under-warns rather than over-warns. A
 * landline or a part-entered number simply gets no warning, which is the
 * safe direction — a false alarm here teaches the admin to ignore the
 * notice entirely.
 */
const MIN_DIGITS = 10;

const DEBOUNCE_MS = 600;

export function DuplicatePhoneNotice({ phone }: { phone: string }) {
  const [matches, setMatches] = useState<CustomerSearchResult[]>([]);

  useEffect(() => {
    const digits = normalizePhoneDigits(phone);
    if (digits.length < MIN_DIGITS) {
      setMatches([]);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      let found: CustomerSearchResult[] = [];
      try {
        const res = await fetch(`/api/search/customers?q=${encodeURIComponent(digits)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Search request failed (${res.status})`);
        const data = (await res.json()) as { results: CustomerSearchResult[] };
        found = data.results;
      } catch {
        // Offline, or the request failed — fall back to this device's own
        // mirror, same as the main search does. A duplicate check that
        // only works online would be useless in the shop's actual
        // conditions, which is the whole reason this app is local-first.
        try {
          found = await searchCustomersLocally(digits);
        } catch {
          // Nothing available to check against. Stay silent rather than
          // claim "no duplicates" — saving is still allowed either way,
          // so a missed warning costs nothing beyond this convenience.
          found = [];
        }
      }
      if (!cancelled) setMatches(found);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phone]);

  if (matches.length === 0) return null;

  return (
    <div
      role="status"
      className="mt-2 rounded-sm border border-amber bg-amber/10 px-3 py-2.5 text-sm text-graphite"
    >
      <p className="font-medium">
        {matches.length === 1
          ? en.customerForm.duplicatePhoneOne
          : en.customerForm.duplicatePhoneManyTemplate.replace("{count}", String(matches.length))}
      </p>
      <ul className="mt-1.5 space-y-1">
        {matches.map((match) => (
          <li key={match.id} className="flex flex-wrap items-baseline gap-x-2">
            {/* Opens in a new tab on purpose: the admin is mid-form with
                a customer in front of them. Navigating away in place
                would abandon whatever they have already typed. */}
            <Link
              href={`/customers/${match.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1"
            >
              {match.name}
            </Link>
            <span className="tabular-nums text-graphite/70">{match.phonePrimary}</span>
            <span className="text-xs text-graphite/50">
              {match.customerCode ?? en.search.noCustomerCode}
              {" · "}
              {match.orderCount === 1
                ? en.search.oneOrder
                : en.search.orderCountTemplate.replace("{count}", String(match.orderCount))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-graphite/60">{en.customerForm.duplicatePhoneHint}</p>
    </div>
  );
}
