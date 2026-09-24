// Step 54 — Part 4's explicit safety mechanism. Every script in
// scripts/ that can create, migrate, seed, or DELETE rows (setup-test-db,
// reset-test-db, test-server) calls assertTestDatabase() as its very
// first action, before touching any database at all. This is a strict
// ALLOWLIST (the database name must exactly equal the one configured
// test database) combined with an explicit DENYLIST of known real
// database names — not a loose heuristic ("doesn't look like
// production") that a coincidentally-test-ish-looking real name could
// slip past.
//
// This is the ONE place this rule lives. Nothing here reads or prints
// DATABASE_URL's credentials — only the trailing database-name segment
// is ever inspected or logged.

// The real, normal development database. Never touched by anything in
// scripts/ — this exists so a misconfigured DATABASE_URL is rejected
// even if it otherwise happened to parse without error.
const REAL_DEVELOPMENT_DB_NAMES = ["sui_dhaga"];

// The one database name test infrastructure is allowed to operate on.
export const EXPECTED_TEST_DB_NAME = "sui_dhaga_test";

/** Extracts just the database name from a postgres connection string — never logs or returns anything else from the URL (user/password/host are never inspected here). */
export function databaseNameFrom(databaseUrl) {
  const url = new URL(databaseUrl);
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

/**
 * Throws (never silently returns false) unless `databaseUrl` points at
 * exactly the expected test database. Callers should let this throw
 * propagate and crash the script — an aborted script is the entire point
 * of this check; there is no "continue anyway" path.
 */
export function assertTestDatabase(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== "string") {
    throw new Error(
      "SAFETY ABORT: DATABASE_URL is not set. Test infrastructure requires an explicit, verified test database " +
        "connection string (see .env.test) — refusing to guess or fall back to any default."
    );
  }

  let dbName;
  try {
    dbName = databaseNameFrom(databaseUrl);
  } catch {
    throw new Error("SAFETY ABORT: DATABASE_URL could not be parsed as a valid connection string. Refusing to proceed.");
  }

  if (REAL_DEVELOPMENT_DB_NAMES.includes(dbName)) {
    throw new Error(
      `SAFETY ABORT: DATABASE_URL points at "${dbName}", which is the real Sui Dhaga development database. ` +
        "Automated test infrastructure must never create, modify, or delete data there. Refusing to proceed."
    );
  }

  if (dbName !== EXPECTED_TEST_DB_NAME) {
    throw new Error(
      `SAFETY ABORT: DATABASE_URL points at "${dbName}", not the expected isolated test database ` +
        `"${EXPECTED_TEST_DB_NAME}". Refusing to proceed rather than guess.`
    );
  }

  return dbName;
}
