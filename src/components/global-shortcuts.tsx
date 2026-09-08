"use client";

// Step 21 — global keyboard shortcuts (design brief §9: "/", Ctrl+N,
// Ctrl+P, Esc). One handler, mounted once in the root layout, rather
// than duplicating window-level listeners per screen.
//
// Deliberately does NOT touch or remove S1's own local "/"/Escape
// handling in search-home.tsx — that handler's extra behaviour (clearing
// the query text specifically when Escape is pressed while the search
// box itself is focused) is more specific than anything this global
// handler needs to do, and the two coexist without conflict: this
// handler's own "navigate to S1" is a no-op when already there (Next's
// router.push to the current route does not remount anything), so
// nothing here fights the local handler.
//
// Also does not touch the order form's own Enter/Tab measurement-field
// sequence or fraction-key handling (order-measurement-block.tsx) — none
// of the keys this component reacts to ("/", Escape, Ctrl+N, Ctrl+P)
// overlap with that field-to-field flow.
//
// Step 38 — Ctrl+P on a NEW order form ("save and print", design brief
// §9) reuses the exact same mechanism S1's own "/" shortcut already uses
// to reach a specific element: a data-shortcut-target attribute
// (order-form.tsx) plus HTMLFormElement.requestSubmit() — the standards
// way to programmatically trigger a form exactly as if its own Submit
// button were clicked, including running the browser's native
// required/pattern constraint validation first and dispatching a real
// `submit` event, which is what lets React's existing Server Action
// wiring on that <form action={...}> pick it up at all (plain
// form.submit() would bypass both and is deliberately not used). No
// second save path, no second validation path, no second Print Preview
// route — this only ever asks the form that's already there to submit
// itself the normal way.
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

// Matches the data attribute added to S1's own search input
// (search-home.tsx) — a stable hook for this component to focus it
// directly when already on S1, independent of that input's copy/label.
const S1_SEARCH_SELECTOR = '[data-shortcut-target="s1-search"]';

// Matches the data attribute added to the order form itself
// (order-form.tsx) — used by both the existing-customer new-order route
// and the Step 25 direct new-customer+order route, since both render the
// same <OrderForm> component. One selector covers both.
const ORDER_FORM_SELECTOR = '[data-shortcut-target="order-form"]';

/** True on either new-order-form route: /customers/{id}/orders/new or /customers/new/order (Step 25). */
function isNewOrderFormContext(pathname: string): boolean {
  return pathname === "/customers/new/order" || /^\/customers\/[^/]+\/orders\/new\/?$/.test(pathname);
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return /^(INPUT|SELECT|TEXTAREA)$/i.test(el.tagName);
}

/** customerId when the path is under /customers/{id} — null for /customers/new (no real customer yet) and anything else. */
function customerContext(pathname: string): string | null {
  const match = pathname.match(/^\/customers\/([^/]+)/);
  if (!match) return null;
  return match[1] === "new" ? null : match[1];
}

/** The real order route this path is under (never /orders/new), with which print-preview subpage (if any) it's already on. */
function orderContext(pathname: string): { customerId: string; orderId: string; subpage: string | null } | null {
  const match = pathname.match(/^\/customers\/([^/]+)\/orders\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return null;
  const [, customerId, orderId, subpage] = match;
  if (orderId === "new") return null;
  return { customerId, orderId, subpage: subpage ?? null };
}

export function GlobalShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  // Step 38 — debounce guard against repeated/rapid Ctrl+P while a save
  // triggered by it is still in flight. No existing pending/submitting
  // state exists on OrderForm to reuse (it has none — confirmed by
  // inspection), so this is the smallest possible net-new state: one
  // boolean, set right before requestSubmit() and cleared a moment
  // later. A pathname-change reset was considered and rejected — a
  // validation failure redirects back to the SAME pathname with only a
  // ?error= query added (usePathname() ignores query strings), so that
  // approach would leave the lock stuck after any invalid submission.
  const orderFormSubmitLockRef = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Escape — "from anywhere", matching the authoritative mockup's own
      // handler exactly: it applies unconditionally, with no editable-
      // field guard, even while typing. Navigating away is safe even
      // mid-edit — the order form's own localStorage draft (Step 14)
      // already survives an unplanned navigation.
      if (event.key === "Escape") {
        if (pathname !== "/dashboard") {
          router.push("/dashboard");
        }
        return;
      }

      // "/" — must never hijack a literal slash being typed into a field.
      if (event.key === "/") {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        if (pathname === "/dashboard") {
          document.querySelector<HTMLInputElement>(S1_SEARCH_SELECTOR)?.focus();
        } else {
          router.push("/dashboard");
          // SearchHome already autofocuses itself on mount — no extra
          // focus hand-off needed once the new page lands.
        }
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;

      // Ctrl/Cmd+N — new order in the current customer context.
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        const customerId = customerContext(pathname);
        if (customerId) {
          router.push(`/customers/${customerId}/orders/new`);
        } else {
          // No customer context (dashboard, Order Board, Settings, the
          // /customers/new creation page itself, ...) — go to the
          // existing S1 search flow to find/select a customer, per Step
          // 21's own instruction, rather than inventing a new entry point.
          router.push("/dashboard");
        }
        return;
      }

      // Ctrl/Cmd+P — the existing print-preview flow for the current order.
      if (event.key.toLowerCase() === "p") {
        // Step 38 — "save and print" (design brief §9) while actively on
        // a new order form: submit the existing form through its
        // existing Server Action (createOrder / createCustomerAndOrder),
        // which already validates, saves, and redirects to the existing
        // S5 Print Preview on success — or back to this same form with
        // ?error= on failure, precisely like clicking Save. Checked
        // before orderContext() below, which already excludes
        // orderId === "new" and would otherwise just no-op here.
        if (isNewOrderFormContext(pathname)) {
          event.preventDefault();
          if (orderFormSubmitLockRef.current) return;
          const form = document.querySelector<HTMLFormElement>(ORDER_FORM_SELECTOR);
          if (form) {
            orderFormSubmitLockRef.current = true;
            form.requestSubmit();
            // Native constraint validation (required/pattern fields) runs
            // synchronously inside requestSubmit() and blocks submission
            // without firing the Server Action at all if anything is
            // invalid — same as a normal Save click — so this lock only
            // ever needs to cover a real in-flight save, not a rejected
            // one. Cleared shortly after regardless, so a genuine retry
            // (e.g. after fixing a validation error) is never blocked for
            // longer than this.
            setTimeout(() => {
              orderFormSubmitLockRef.current = false;
            }, 1500);
          }
          return;
        }

        const order = orderContext(pathname);
        if (!order) {
          // No order context — nothing app-specific to print here; let
          // the browser's own Ctrl/Cmd+P proceed normally.
          return;
        }
        event.preventDefault();
        if (order.subpage === "receipt" || order.subpage === "work-order") {
          // Already on a print-preview page — print it directly, exactly
          // what that page's own Print button already does (Step 16).
          window.print();
        } else {
          // Order detail, S5 Print Preview (Step 29), or WhatsApp page —
          // go to the existing Receipt preview route, reusing Step 16's
          // architecture unchanged. order.subpage is matched generically
          // by orderContext()'s own regex, so the new /print-preview route
          // already falls into this branch with no change needed here:
          // S5 itself offers direct links to both documents: this
          // shortcut just needs one unambiguous default, and Receipt
          // (the customer-facing, smaller document) was already that
          // default from Order Detail/WhatsApp before S5 existed.
          router.push(`/customers/${order.customerId}/orders/${order.orderId}/receipt`);
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);

  return null;
}
