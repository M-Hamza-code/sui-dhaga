# Sui Dhaga — Quick Start

For the full technical handover (development history, complete feature inventory, database docs, known issues), read **`PROJECT_HANDOFF.md`** in this same directory first. This file is a short operational reference only.

## Project purpose

A single-admin management app for a tailoring shop: customers, their measurements, stitching orders, a bilingual print workflow (Urdu work order for the tailor, English receipt for the customer), and a WhatsApp handoff. It's a PWA — works offline on the shop floor; queued writes sync when connectivity returns.

## Tech stack (installed versions, confirmed 2026-11-08)

Next.js 14.2.15 (App Router, Server Components + Server Actions) · React 18.3.1 · Prisma 5.20.0 + PostgreSQL · Dexie 4.4.5 (IndexedDB offline layer) · Tailwind CSS 3.4.13 · TypeScript 5.6.3 · zod 3.23.8 · bcryptjs 2.4.3 · lucide-react 1.47.0

## Setup

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL, SESSION_SECRET, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
createdb sui_dhaga
npx prisma migrate deploy
npm run seed              # creates the admin account + DesignOption rows; safe to re-run
```

## Run

```bash
npm run dev       # http://localhost:3000, sign in at /login with SEED_ADMIN_* credentials
npm run build && npm start   # production
```

**Never run `npm run build` while `npm run dev` is active on the same project** — they share the `.next` folder and a concurrent build can corrupt it. Stop the dev server first.

## Safe testing commands

```bash
npm run test:db:setup                              # one-time: creates/migrates/seeds sui_dhaga_test
node scripts/run-tests.mjs path/to/your-test.mjs    # runs a test file against an isolated server + sui_dhaga_test
npx tsc --noEmit                                    # type-check (safe, read-only, no DB access)
```

**No test suite files currently exist in this repository** — the infrastructure above is real and working, but you'll be writing the first one. `assertTestDatabase()` (`scripts/lib/test-db-guard.mjs`) refuses to run against anything except `sui_dhaga_test` — it explicitly denylists the real `sui_dhaga` by name. Never bypass it; never point `.env.test` at the real database.

## Critical architecture rules (see PROJECT_HANDOFF.md Part 7 for the full list)

1. **Collar and Bain are mutually exclusive** — exactly one of `Order.collarType`/`bainType`, enforced in `order-actions.ts`, not by the DB.
2. **`balanceAmount` is always server-computed** (`total − advance`, via `src/lib/money.ts`) — never accept it as client input.
3. **`MeasurementSnapshot` rows are immutable** — an edit creates a new one; never mutate an existing snapshot.
4. **Deleting an order never cascades to the customer.** Deleting a customer *does* cascade to hard-delete their orders (by design, not a bug).
5. **Customer search matching logic is shared** between online (`customer-search-query.ts`) and offline (`offline/customer-search-local.ts`) via one module, `customer-search-matching.ts` — don't fork it.
6. **The offline sync queue is strict FIFO by `createdAt`**, single-flight, with real conflict capture/resolution (Settings → General). Don't add a feature whose correctness depends on out-of-order processing.
7. **Reuse `use-delete-order.ts` for any delete-order UI** — don't write a second implementation.
8. **Not every mutation path is offline-capable**: the combined "new customer + order" flow (`createCustomerAndOrder`) is online-only; almost everything else (plain customer create/edit, measurement save, order create/edit/delete/status) is offline-capable via the Dexie sync queue. Know which is which before assuming a flow works offline.

## Important files to read first

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma` (its own header comments are a mini design history) |
| Order logic | `src/lib/order-actions.ts`, `order-build.ts`, `order-create-sync.ts`/`order-update.ts`/`order-delete.ts` |
| Customer logic | `src/lib/customer-actions.ts`, `customer-sync.ts`, `customer-search-matching.ts` |
| Offline/sync | `src/lib/offline/sync-engine.ts`, `initial-sync.ts`, `db.ts` |
| Auth | `src/lib/auth.ts`, `auth-actions.ts`, `session.ts`, `src/middleware.ts` |
| Test infra | `scripts/README.md`, `scripts/lib/test-db-guard.mjs`, `scripts/run-tests.mjs` |

## Manual verification pages (no automated UI tests exist)

`/dev/sync-check`, `/dev/offline-db-check`, `/dev/pwa-check` — unlinked, auth-protected, exercise the real production functions. Use these to manually verify offline/sync behavior.

## Instructions for the next AI assistant

Read `PROJECT_HANDOFF.md` in full before making changes — it documents ~65 development steps' worth of history, every feature's actual (code-verified) implementation status, and a list of known issues/gaps. Then follow this mandatory rule for every task:

> Before making any changes, inspect the existing implementation and understand the related workflow. Preserve all previously working functionality. Do not unnecessarily refactor or modify unrelated files. After implementation, run appropriate tests, type-check and build. Verify that existing functionality has not regressed. Never run automated tests against the normal development database.

Report completed work by stating exactly which files changed, which existing mechanism was reused (not duplicated), what was verified and how (test output, type-check output, or "verified by direct code reading" if no test was run — be explicit about which), and any new limitation introduced.
