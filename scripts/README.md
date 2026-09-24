# Test infrastructure (Step 54)

The normal `npm run dev` server always uses `.env`'s `DATABASE_URL` — the
real Sui Dhaga development database (`sui_dhaga`). It is never touched by
anything in this folder.

Automated tests (`test-phase*.mjs`, `test-step*.mjs`) run as real HTTP
requests against a running server. Before Step 54, every test file's
`BASE` constant pointed at `http://localhost:3000` — the same server (and
therefore the same database) the admin uses. That was the entire root
cause of test data (`Step53 Edit Order Customer`, `Debug Cust`, etc.)
appearing in the real Dashboard/Order Board. Every test file's `BASE` now
reads `process.env.TEST_BASE_URL || "http://localhost:3001"` — a
different port, served by a completely separate process with its own
`DATABASE_URL` (`.env.test` → the `sui_dhaga_test` database).

## One-time setup

```
npm run test:db:setup
```

Creates `sui_dhaga_test` (if it doesn't already exist), applies every
existing Prisma migration to it, and seeds it with the same admin
account + placeholder Pocket/Patti design options `prisma/seed.ts`
already seeds the real database with. Safe to re-run any time.

## Running the test suite

```
node scripts/run-tests.mjs <path-to-test-file.mjs> [...more]
```

Starts the isolated test server (port 3001 by default), waits for it,
runs each given test file as a child process (so even a test's own
embedded direct-Prisma check inherits the test database's
`DATABASE_URL`, not just its HTTP calls), then always shuts the server
down. Exits non-zero if any test file failed.

To instead leave the isolated server running (e.g. for interactive use,
or running several test files by hand against it):

```
npm run test:server        # leaves it running on :3001
node test-phase6.mjs        # any test file, run directly — TEST_BASE_URL
                             # unset here, so it uses its own :3001 default
```

## Resetting test data

```
npm run test:db:reset
```

Wipes every Customer/Order/OrderItem/MeasurementSnapshot/Measurement row
from `sui_dhaga_test` — never the real database. Config rows
(User/DesignOption/ShopSettings) are left alone.

## The safety guard

Every script above calls `assertTestDatabase()`
(`scripts/lib/test-db-guard.mjs`) before opening any database
connection. It throws — aborting the script — unless `DATABASE_URL`
resolves to exactly `sui_dhaga_test`. It explicitly denylists the real
database name (`sui_dhaga`) too, so a misconfigured `.env.test` can never
silently fall through to acting on real data.
