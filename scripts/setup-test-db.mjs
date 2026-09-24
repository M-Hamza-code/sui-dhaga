// Step 54 — Part 3. Creates (if needed), migrates, and minimally seeds
// the isolated test database. Safe to run repeatedly — every step is
// idempotent: an already-existing database is left alone, `prisma
// migrate deploy` only applies migrations not yet applied, and the
// existing seed script (prisma/seed.ts) already upserts rather than
// duplicating (see that file's own comments).
//
// Never touches the real development database — assertTestDatabase()
// (Part 4) is the first thing this does, before any connection is
// opened, and every subsequent step only ever uses the DATABASE_URL
// that already passed that check.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertTestDatabase } from "./lib/test-db-guard.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.loadEnvFile(path.join(PROJECT_ROOT, ".env.test"));
const dbName = assertTestDatabase(process.env.DATABASE_URL);
console.log(`✔ Verified isolated test database: "${dbName}"`);

// Dynamic import, deliberately AFTER loadEnvFile()/assertTestDatabase()
// above: a static top-level `import { PrismaClient } from "@prisma/client"`
// is hoisted and runs before any of this file's own code — including
// before process.loadEnvFile() — and @prisma/client's generated runtime
// does its own automatic .env loading as a side effect of being
// imported. That auto-load would set DATABASE_URL from the REAL .env
// first, and loadEnvFile() never overrides an already-set variable, so
// .env.test would silently lose the race. Deferring the import until
// after .env.test is loaded closes that gap.
const { PrismaClient } = await import("@prisma/client");

async function ensureDatabaseExists() {
  // Connect to Postgres's own maintenance database ("postgres", always
  // present) with the SAME host/credentials, only to check for and
  // create the sibling test database — never to read/write any
  // application data. A fresh Prisma Client instance, not the generated
  // singleton (@/lib/prisma), and only ever pointed at this one admin
  // connection string.
  const testUrl = new URL(process.env.DATABASE_URL);
  const adminUrl = new URL(testUrl.toString());
  adminUrl.pathname = "/postgres";

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const existing = await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, dbName);
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`✔ Database "${dbName}" already exists.`);
      return;
    }
    // CREATE DATABASE cannot be parameterized — dbName comes from
    // assertTestDatabase()'s own strict allowlist above (it can only
    // ever be the one literal expected test name), never from
    // unvalidated input, so this is safe despite the string interpolation.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`✔ Created database "${dbName}".`);
  } finally {
    await admin.$disconnect();
  }
}

function run(command, args, extraEnv = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  // A single pre-joined command string, not an argv array, when
  // shell:true — args here are fixed literals this file itself wrote
  // (never user input), but joining avoids Node's own shell-argument-
  // escaping deprecation warning either way.
  const result = spawnSync([command, ...args].join(" "), {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${command} ${args.join(" ")}) with exit code ${result.status}`);
  }
}

await ensureDatabaseExists();

// Applies every existing migration (same files under prisma/migrations/
// the real database already has) — never generates a new one, never
// touches the migration files themselves.
run("npx", ["prisma", "migrate", "deploy"]);

// The EXISTING seed script, unchanged — the same admin account +
// placeholder Pocket/Patti design options the real database was seeded
// with (see prisma/seed.ts's own comment), now applied to the test
// database instead. No second seed implementation.
run("npx", ["tsx", "prisma/seed.ts"]);

console.log(`\n✔ Test database "${dbName}" is ready.`);
