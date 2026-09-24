// Step 54 — Part 3/4/7. The single entry point for running the existing
// test-*.mjs suite in full isolation: starts the isolated test server
// (Step 2 — its own port, its own DATABASE_URL), waits for it to be
// ready, runs each given test file as a CHILD of this process (so it
// inherits the test DATABASE_URL too — this is what keeps a test file's
// own embedded direct-Prisma verification calls, e.g.
// `execSync('node -e "...PrismaClient...")'`, pointed at the test
// database as well, not just its HTTP requests), then always shuts the
// server down, whether the tests passed or not.
//
// Usage: node scripts/run-tests.mjs <absolute-path-to-test-file> [...more]
// Each test file's own exit code is respected; this exits non-zero if
// ANY of them failed.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestDatabase } from "./lib/test-db-guard.mjs";

/**
 * `server.kill()` alone only signals the immediate child — on Windows,
 * `shell:true` means that child is a cmd.exe wrapper around `npx`, which
 * itself wraps the actual `next dev` process; killing just the wrapper
 * leaves the real server listening (confirmed: it kept serving requests
 * on its port after a plain kill()). taskkill's /T walks the whole
 * process tree instead. POSIX doesn't have this problem (kill() reaches
 * the direct child, which IS the real process there), so this only
 * special-cases win32.
 */
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
console.log(`✔ Verified isolated test database: "${dbName}"`);

const port = process.env.TEST_SERVER_PORT || "3001";
const baseUrl = `http://localhost:${port}`;
// The one env var every test file's own `BASE` constant now reads (see
// each test-*.mjs's own `const BASE = process.env.TEST_BASE_URL || ...`)
// — set here so it's impossible for a test spawned by this script to
// silently fall back to guessing a port.
process.env.TEST_BASE_URL = baseUrl;

const testFiles = process.argv.slice(2);
if (testFiles.length === 0) {
  console.error("Usage: node scripts/run-tests.mjs <test-file.mjs> [...more test files]");
  process.exit(1);
}

console.log(`Starting isolated test server on ${baseUrl} ...`);
const server = spawn(`npx next dev -p ${port}`, {
  cwd: PROJECT_ROOT,
  env: process.env,
  stdio: "inherit",
  shell: true,
});

let serverExited = false;
server.on("exit", () => {
  serverExited = true;
});

async function waitUntilReady(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (serverExited) return false;
    try {
      const res = await fetch(`${baseUrl}/login`);
      if (res.status === 200) return true;
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function stopServer() {
  if (!serverExited) {
    killProcessTree(server.pid);
  }
}

const ready = await waitUntilReady();
if (!ready) {
  console.error(`Test server never became ready on ${baseUrl} — aborting.`);
  stopServer();
  process.exit(1);
}
console.log(`✔ Test server ready on ${baseUrl}\n`);

let exitCode = 0;
for (const file of testFiles) {
  console.log(`\n=== ${path.basename(file)} ===`);
  const result = spawnSync(process.execPath, [file], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) exitCode = 1;
}

stopServer();
process.exit(exitCode);
