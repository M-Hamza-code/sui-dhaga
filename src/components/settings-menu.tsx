"use client";

// Step 51 — replaces the header's old three-piece Settings-nav-item /
// Admin-readout / Logout-button area with a single Settings icon button
// that opens a small dropdown.
//
// Step 56 (Issue 5) — the button's own icon changed from a hand-drawn
// gear SVG to lucide-react's SlidersHorizontal (the requested "multiple
// horizontal lines/sliders, one above another" icon) — lucide-react is
// now a real dependency (Step 56 also added it for Trash2 on the Order
// Board), so this no longer needs to be a bespoke inline SVG. Nothing
// else about this button/menu changed: same aria-label, same click
// target, same dropdown, same three settings views, same logout form.
//
// The three menu items are plain <Link>s to the existing /settings route
// with a `?view=` query param (see src/app/settings/page.tsx) — no new
// routing mechanism, no client-side settings state, no duplicated
// settings logic. Logout is the exact same `logout` Server Action/form
// that used to sit directly in the header, just relocated into this
// menu. Closing behavior: Escape, a click outside, or picking any item
// (a real navigation) all close the menu.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { logout } from "@/lib/auth-actions";
import { en } from "@/lib/locale";

export function SettingsMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={en.nav.settings}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-sm border border-rule text-graphite transition hover:bg-paper hover:text-indigo focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2"
      >
        <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={en.nav.settings}
          className="absolute right-0 top-full z-20 mt-2 w-56 rounded-sm border border-rule bg-card p-1.5 shadow-sm"
        >
          <MenuLink href="/settings?view=profile" onSelect={() => setOpen(false)}>
            {en.settingsMenu.profile}
          </MenuLink>
          <MenuLink href="/settings?view=defaults" onSelect={() => setOpen(false)}>
            {en.settingsMenu.defaultPrice}
          </MenuLink>
          <MenuLink href="/settings?view=general" onSelect={() => setOpen(false)}>
            {en.settingsMenu.setting}
          </MenuLink>

          <div className="my-1.5 border-t border-rule" />

          {email && (
            <p className="truncate px-3 py-1 text-xs text-graphite/50" title={email}>
              {en.nav.admin} · {email}
            </p>
          )}

          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full rounded-sm px-3 py-1.5 text-left text-sm text-graphite transition hover:bg-paper hover:text-ink"
            >
              {en.nav.logout}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  onSelect,
  children,
}: {
  href: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="block rounded-sm px-3 py-1.5 text-sm text-graphite transition hover:bg-paper hover:text-indigo"
    >
      {children}
    </Link>
  );
}
