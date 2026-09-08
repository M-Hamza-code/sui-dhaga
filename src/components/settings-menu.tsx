"use client";

// Step 51 — replaces the header's old three-piece Settings-nav-item /
// Admin-readout / Logout-button area with a single Settings icon button
// that opens a small dropdown. No icon library dependency added — the
// project has none, and a full package for one gear glyph would be
// unnecessary weight, so this is a plain inline SVG (the same "no new
// dependency for a decorative element" call Step 41's measurement-
// diagram silhouette already made).
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
        <GearIcon />
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

// Plain inline gear glyph — decorative only (aria-hidden; the button
// itself carries the accessible name via aria-label).
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.5v2m0 13v2m8.5-8.5h-2m-13 0h-2m13.03-5.53-1.41 1.41M6.88 17.12l-1.41 1.41m0-13.06 1.41 1.41m10.24 10.24 1.41 1.41"
      />
    </svg>
  );
}
