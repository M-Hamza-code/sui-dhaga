"use client";

// Phase 7 (Part D) — a small, additive sync-state tag for the Customer
// Profile's "Saved Measurements" card, mirroring PendingOrdersNotice's
// scope from Phase 6 (a tiny client component reading Dexie, rendered
// alongside an otherwise-untouched server-rendered SectionCard). Does
// NOT touch measurement-form.tsx at all — "the existing measurement
// form design" stays exactly as Phase 6 left it, per this phase's own
// instruction.
//
// Renders nothing when there's no local mirror row yet at all (a
// customer whose measurement has never been touched locally this
// session — the server-rendered age line above/below this is the only
// thing that applies) and nothing for "synced" beyond a quiet
// confirmation, matching CustomerIdentityCard's own "say nothing extra
// when everything is fine" convention.
import { useEffect, useState } from "react";
import { readMeasurementSyncBadge, type SyncState } from "@/lib/offline/sync-status";

const TEXT: Record<SyncState, string> = {
  synced: "Synced",
  syncing: "Saving locally…",
  pending: "Pending sync",
  failed: "Sync failed",
  conflict: "Needs attention",
};

// Phase 10 (§1) — a hover tooltip spelling out what the short tag means
// in plain terms, so "Pending sync"/"Sync failed" never read as "this
// measurement is missing or broken" — it's saved right here, just not
// on the server yet.
const TITLE: Record<SyncState, string> = {
  synced: "This measurement matches what's saved on the server.",
  syncing: "Saving to this device…",
  pending: "Saved on this device — will reach the server once you're back online.",
  failed: "Saved on this device — couldn't reach the server yet. Nothing was lost.",
  conflict: "This measurement was changed somewhere else and needs review before it can sync.",
};

const TONE: Record<SyncState, string> = {
  synced: "text-graphite/40",
  syncing: "text-indigo",
  pending: "text-amber",
  failed: "text-red-700",
  conflict: "text-red-700",
};

export function MeasurementSyncBadge({ customerId }: { customerId: string }) {
  const [badge, setBadge] = useState<SyncState | null>(null);

  useEffect(() => {
    let cancelled = false;
    readMeasurementSyncBadge(customerId).then((result) => {
      if (!cancelled) setBadge(result);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (!badge) return null;

  return (
    <span className={`text-xs font-medium ${TONE[badge]}`} title={TITLE[badge]}>
      {TEXT[badge]}
    </span>
  );
}
