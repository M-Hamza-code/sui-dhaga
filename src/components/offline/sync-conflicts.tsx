"use client";

// The conflict-resolution UI the sync engine always expected but never
// had. sync-engine.ts's own comment used to read "a future phase can
// build real conflict-resolution UI against it. No such UI is
// implemented in this phase." — this is that UI.
//
// Until now a conflict was a dead end. The app correctly detected that an
// edit had been refused because the record changed elsewhere, and
// correctly said "needs attention", but offered nothing to DO: the queue
// item sat at "failed" indefinitely, and "Retry failed" resent it with
// the same stale baseline so it failed identically every time. The only
// escape was clearing browser storage, which discards the unsynced edit.
//
// Two choices are offered, because there are honestly only two:
//   - Keep my version  -> re-base the edit on the server's current
//                         version and send it, overwriting what changed
//                         there.
//   - Use server's     -> discard this local edit and pull the server's
//                         values down.
//
// Both are consequential, so each says plainly what it will do before
// it's pressed, and each is confirmed. Neither is presented as the
// "safe" default — which one is right depends on what actually changed,
// and only the person at the counter knows that.
//
// Renders nothing at all when there are no conflicts, which is the
// normal state. It is deliberately not an empty-state card competing for
// attention in Settings.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  readConflicts,
  resolveConflictKeepLocal,
  resolveConflictUseServer,
  type ConflictEntry,
} from "@/lib/offline/sync-engine";
import { getOfflineDb, isOfflineDbAvailable } from "@/lib/offline/db";
import { formatOrderNumber } from "@/lib/format";
import { en } from "@/lib/locale";

/** A conflict plus the human-readable identity of the record it concerns. */
interface ConflictRow extends ConflictEntry {
  /** e.g. "Muhammad Hammad Arshad" or "Order 12 — Muhammad Hammad Arshad". */
  label: string;
  /** Where to look at the record, so the user can decide with the facts in front of them. */
  href: string | null;
}

export function SyncConflicts() {
  const [rows, setRows] = useState<ConflictRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve each conflict's record into something a person can
  // recognise. Reads the local tables only — the whole point is that
  // this has to work offline, which is when conflicts are most likely to
  // have built up in the first place.
  const load = useCallback(async () => {
    if (!isOfflineDbAvailable()) {
      setLoaded(true);
      return;
    }
    try {
      const entries = await readConflicts();
      const db = getOfflineDb();
      await db.open();

      const resolved: ConflictRow[] = [];
      for (const entry of entries) {
        if (entry.recordType === "customer") {
          const customer = await db.customers.get(entry.recordId);
          resolved.push({
            ...entry,
            label: customer?.name ?? en.syncConflicts.unknownCustomer,
            href: `/customers/${entry.recordId}`,
          });
        } else {
          const order = await db.orders.get(entry.recordId);
          const customer = order ? await db.customers.get(order.customerId) : undefined;
          const number = order?.orderNumber ? formatOrderNumber(order.orderNumber) : "—";
          resolved.push({
            ...entry,
            label: en.syncConflicts.orderLabelTemplate
              .replace("{number}", number)
              .replace("{customer}", customer?.name ?? en.syncConflicts.unknownCustomer),
            href: order ? `/customers/${order.customerId}/orders/${entry.recordId}` : null,
          });
        }
      }
      setRows(resolved);
    } catch {
      // Reading the local database failed. Say nothing rather than claim
      // there are no conflicts — a false "all clear" here is worse than
      // silence, since it would stop the user looking.
      setRows([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleKeepLocal(row: ConflictRow) {
    if (!window.confirm(en.syncConflicts.confirmKeepLocalTemplate.replace("{record}", row.label))) return;
    setError(null);
    setBusyId(row.queueItemId);
    const result = await resolveConflictKeepLocal(row.queueItemId);
    if (!result.ok) setError(result.message);
    await load();
    setBusyId(null);
  }

  async function handleUseServer(row: ConflictRow) {
    if (!window.confirm(en.syncConflicts.confirmUseServerTemplate.replace("{record}", row.label))) return;
    setError(null);
    setBusyId(row.queueItemId);
    const result = await resolveConflictUseServer(row.queueItemId);
    if (!result.ok) setError(result.message);
    await load();
    setBusyId(null);
  }

  // Nothing to show before the first read completes, and nothing to show
  // when there are no conflicts — the overwhelmingly normal case.
  if (!loaded || rows.length === 0) return null;

  return (
    <section className="rounded-sm border border-amber bg-amber/10 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{en.syncConflicts.heading}</h2>
      <p className="mt-2 text-sm text-graphite">{en.syncConflicts.intro}</p>

      {error && (
        <p role="alert" className="mt-3 rounded-sm border border-red-300 bg-card px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const busy = busyId === row.queueItemId;
          return (
            <li key={row.queueItemId} className="rounded-sm border border-rule bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-graphite">{row.label}</p>
                {row.href && (
                  <Link
                    href={row.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-indigo hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1"
                  >
                    {en.syncConflicts.viewRecord}
                  </Link>
                )}
              </div>
              {row.message && <p className="mt-1 text-sm text-graphite/60">{row.message}</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleKeepLocal(row)}
                  disabled={busy || !row.canKeepLocal}
                  title={row.canKeepLocal ? undefined : en.syncConflicts.keepLocalUnavailable}
                  className="rounded-sm bg-indigo px-3.5 py-2 text-sm text-white transition hover:bg-indigo-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? en.syncConflicts.working : en.syncConflicts.keepLocal}
                </button>
                <button
                  type="button"
                  onClick={() => handleUseServer(row)}
                  disabled={busy}
                  className="rounded-sm border border-rule px-3.5 py-2 text-sm text-graphite transition hover:bg-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? en.syncConflicts.working : en.syncConflicts.useServer}
                </button>
              </div>

              {/* Says what each button does in plain terms. Both are
                  irreversible in the direction they go, so the choice
                  should never rest on guessing from the labels. */}
              <p className="mt-2 text-xs text-graphite/60">{en.syncConflicts.optionsHint}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
