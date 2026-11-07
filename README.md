# Sui Dhaga — Digital Management System

A single-admin management app for a tailoring shop: customers, their
measurements, stitching orders, a work-order/receipt print flow, and a
WhatsApp handoff for customer updates. It is a PWA — the shop floor can
keep searching customers and taking orders while offline, and the queued
writes sync when the connection returns.

Built with Next.js 14 (App Router, Server Components + Server Actions),
Prisma 5 on PostgreSQL, Tailwind CSS, and Dexie (IndexedDB) for the
offline layer.

## Requirements

- **Node.js 18.17+** (tested on 18.20)
- **PostgreSQL 14+** running locally (or any reachable Postgres)

## Setup

```bash
npm install
cp .env.example .env     # then edit it — see below
```

Fill in `.env`:

| Variable | What it's for |
| --- | --- |
| `DATABASE_URL` | Prisma's Postgres connection string. |
| `SESSION_SECRET` | Signs the admin session cookie. Generate with `openssl rand -base64 32`. |
| `SEED_ADMIN_EMAIL` | Read **only** by the seed script, to create the one admin account. |
| `SEED_ADMIN_PASSWORD` | Same — the admin's initial password. Rotate after first seed. |

Create the database, apply migrations, and seed:

```bash
createdb sui_dhaga            # skip if it already exists
npx prisma migrate deploy     # or: npm run prisma:migrate (dev)
npm run seed
```

The seed creates the single admin account plus the `DesignOption` rows
(Pocket and Patti/Placket choices). It is safe to re-run: it never
overwrites an existing admin's password.

## Running

```bash
npm run dev       # http://localhost:3000
```

Sign in at `/login` with the `SEED_ADMIN_*` credentials. Every app route
is behind the session cookie — an unauthenticated visitor to any of them
is redirected to `/login` by `src/middleware.ts`.

For production:

```bash
npm run build
npm start
```

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server on :3000, against `.env`'s `DATABASE_URL`. |
| `npm run build` / `npm start` | Production build / serve. |
| `npm run lint` | `next lint`. |
| `npm run prisma:generate` | Regenerate the Prisma client. |
| `npm run prisma:migrate` | Create + apply a migration in dev. |
| `npm run prisma:studio` | Browse the database in Prisma Studio. |
| `npm run seed` | Seed admin + design options. |
| `npm run test:db:setup` | One-time: create and migrate the isolated `sui_dhaga_test` database. |
| `npm run test:db:reset` | Wipe customer/order data from the test database only. |
| `npm run test:server` | Run a second server on :3001 against `.env.test`. |
| `npm run test:run` | Run test files against that isolated server. |

Tests never touch the real database — they run as HTTP requests against
a separate server on :3001 with its own `.env.test`, guarded by
`assertTestDatabase()`. See [`scripts/README.md`](scripts/README.md).

## Routes

| Route | Screen |
| --- | --- |
| `/login` | Admin sign-in. |
| `/dashboard` | Search / home — find a customer by name or phone. |
| `/overview` | Dashboard: today's counts, outstanding balance, recent activity. |
| `/orders` | Order board, tabbed by new / overdue / due today / ready / outstanding / delivered. |
| `/customers` | Customer list. |
| `/customers/new`, `/customers/[id]` | Create a customer; customer profile. |
| `/customers/[id]/measurement/edit` | The customer's current measurement. |
| `/customers/[id]/orders/new` | New order for an existing customer. |
| `/customers/new/order` | New customer and their first order in one flow. |
| `/customers/[id]/orders/[orderId]` | Order detail, edit, receipt, work order, print preview, WhatsApp message. |
| `/settings` | Shop details, default prices, data backup/export. |
| `/offline` | Shown by the service worker when a page isn't cached. |
| `/dev/*` | Unlinked manual-verification pages (sync, offline DB, PWA). Auth-protected. |

## Data model

Defined in [`prisma/schema.prisma`](prisma/schema.prisma), which documents
the rules that matter in its header comments. The essentials:

- **Customer** — soft-deleted via `deletedAt`.
- **Measurement** — exactly **one current row per customer**
  (`customerId @unique`), upserted in place. There is no measurement
  history or versioning.
- **MeasurementSnapshot** — an independent, frozen *copy* of measurement
  values taken when an order is placed. Never linked back to the live
  `Measurement` row, so editing a customer's measurements never rewrites
  a past order.
- **Order** → **OrderItem** — one `OrderItem` per physical suit. An item
  inherits the order's default snapshot unless it carries its own
  override ("different measurements for this suit").
- **DesignOption** — lookup table for Pocket and Patti/Placket choices.
  Codes are the stable key and map to the photos in
  `public/design-images/`; add codes, never rename them.
- **ShopSettings** — a singleton row (`singleton: true`) holding shop
  details and default prices.

Style choices (suit type, collar, bain, cuff, ghera) are Postgres enums.
`OrderStatus.PENDING` is a legacy Phase-1 value kept only for backward
compatibility — new code writes `NEW`.

## Offline support

`src/lib/offline/` holds the PWA layer: a Dexie (IndexedDB) mirror of the
customer/order data (`db.ts`), an initial sync (`initial-sync.ts`), and a
single FIFO sync queue drained by `sync-engine.ts`. Queued operations post
to the `/api/sync/*` routes once connectivity returns; strict
ordering-by-`createdAt` means a customer created offline and edited in the
same session syncs in the right order. Failed items stay visible rather
than being silently dropped. The service worker lives at `public/sw.js`
and the manifest is generated by `src/app/manifest.ts`.

## Project layout

```
prisma/          schema, migrations, seed
public/          service worker, PWA icons, design option photos
scripts/         isolated test database + test runner (see its README)
src/app/         routes — pages, server actions' callers, /api/sync endpoints
src/components/  UI, grouped by area (customers, orders, measurement, print, …)
src/lib/         server actions, domain logic, formatting, offline layer, en locale
src/middleware.ts  session-based route protection
```

Baseline security headers (`X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`) are set for every route in `next.config.mjs`.
