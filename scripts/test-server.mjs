// Step 54 — Part 2/3. Starts a SECOND, fully isolated Next.js dev server
// — its own process, its own port, its own DATABASE_URL — so automated
// tests have somewhere to run against that is never the same server (or
// database) the admin's own normal `npm run dev` uses. The two can run
// at the same time with zero interference: different ports, different
// databases, no shared state.
//
// assertTestDatabase() (Part 4) runs before this ever spawns `next dev`
// — if DATABASE_URL doesn't resolve to exactly the isolated test
// database, this refuses to start a server at all, rather than risk
// serving real traffic against the wrong database.
//
// Usage: `npm run test:server` (defaults to port 3001; override with
// TEST_SERVER_PORT). Leave it running in its own terminal while running
// test-*.mjs files against it, or let run-tests.mjs manage its lifecycle
// automatically for a single non-interactive run.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestDatabase } from "./lib/test-db-guard.mjs";

// See run-tests.mjs's own comment on why plain kill() isn't enough on
// Windows (shell:true wraps the real `next dev` process in cmd.exe/npx,
// and killing only the wrapper leaves it running).
function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.loadEnvFile(path.join(PROJECT_ROOT, ".env.test"));
const dbName = assertTestDatabase(process.env.DATABASE_URL);

const port = process.env.TEST_SERVER_PORT || "3001";
console.log(`✔ Verified isolated test database: "${dbName}"`);
console.log(`Starting isolated test server on http://localhost:${port} ...`);

const child = spawn(`npx next dev -p ${port}`, {
  cwd: PROJECT_ROOT,
  env: process.env,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => killProcessTree(child.pid));
process.on("SIGTERM", () => killProcessTree(child.pid));
