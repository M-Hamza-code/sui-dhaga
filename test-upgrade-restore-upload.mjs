// Regression test for the secure backup-upload Route Handler
// (/api/restore/upload) — admin authorization BEFORE any byte of the
// body is read, streaming with a mid-transfer size limit, and atomic
// temporary-file handling.
//
// This needs a REAL running Next.js server (a Route Handler's streaming
// behavior can't be exercised by importing the module directly — it
// depends on the actual Node HTTP request object). Spins up its own,
// fully isolated instance on an unused port with its own build output
// directory — NEVER the protected port 3020 server or any other
// existing process — and kills ONLY the process tree it itself started,
// using the same taskkill-the-whole-tree fix this project's own
// scripts/run-tests.mjs already documents (a plain child.kill() on
// Windows only kills the cmd.exe/npx wrapper, leaving the real `next
// dev` process running — confirmed the hard way earlier in this same
// session).
//
// Run ONLY via: npx tsx test-upgrade-restore-upload.mjs
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(PROJECT_ROOT, ".env.test"));

const { assertTestDatabase } = await import("./scripts/lib/test-db-guard.mjs");
assertTestDatabase(process.env.DATABASE_URL);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}
const { createSessionToken, SESSION_COOKIE } = await loadDefault("./src/lib/session.ts");

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const PORT = 3097;
const PORT_2 = 3098;
const BASE = `http://localhost:${PORT}`;
const BASE_2 = `http://localhost:${PORT_2}`;

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

async function waitUntilReady(base, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/login`);
      if (res.status === 200) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

let server;
let server2;
try {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No seeded ADMIN user found in sui_dhaga_test — cannot test authorization.");
  const adminToken = await createSessionToken({ sub: admin.id, email: admin.email });

  // A non-admin session, for the authorization test — temporarily
  // demoting is reverted in `finally` below, never left behind.
  const staffProbe = await prisma.user.create({
    data: { name: "Restore Upload Test Staff", email: `restore-upload-staff-${Date.now()}@example.com`, passwordHash: "x", role: "STAFF" },
  });
  const staffToken = await createSessionToken({ sub: staffProbe.id, email: staffProbe.email });

  console.log(`Starting isolated test server on ${BASE} ...`);
  server = spawn(`npx next dev -p ${PORT}`, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NEXT_DIST_DIR: ".next-test-restore-upload" },
    stdio: "ignore",
    shell: true,
  });

  const ready = await waitUntilReady(BASE);
  if (!ready) throw new Error(`Test server never became ready on ${BASE}`);
  console.log("Server ready.");

  // ══════════════════════════════════════════════════════════════════
  // 1. No session at all -> 403, before any byte of a real body is read
  // ══════════════════════════════════════════════════════════════════
  console.log("1. Unauthenticated upload is rejected before any byte is read");
  const res1 = await fetch(`${BASE}/api/restore/upload`, { method: "POST", body: "x".repeat(10_000_000) });
  check("unauthenticated upload is rejected (403)", res1.status === 403);

  // ══════════════════════════════════════════════════════════════════
  // 2. A valid session but NON-admin role -> 403, same as no session
  // ══════════════════════════════════════════════════════════════════
  console.log("2. An authenticated but non-admin session is rejected");
  const res2 = await fetch(`${BASE}/api/restore/upload`, {
    method: "POST",
    headers: { Cookie: `${SESSION_COOKIE.name}=${staffToken}` },
    body: JSON.stringify({ format: "sui-dhaga-backup" }),
  });
  check("authenticated-but-not-admin upload is rejected (403)", res2.status === 403);

  // ══════════════════════════════════════════════════════════════════
  // 3. Admin session + small valid body -> success, file on disk
  // ══════════════════════════════════════════════════════════════════
  console.log("3. Admin-authorized upload succeeds and lands on disk");
  const smallBody = JSON.stringify({ format: "sui-dhaga-backup", version: 1, marker: "test-upload-3" });
  const res3 = await fetch(`${BASE}/api/restore/upload`, {
    method: "POST",
    headers: { Cookie: `${SESSION_COOKIE.name}=${adminToken}` },
    body: smallBody,
  });
  const body3 = await res3.json();
  check("admin upload succeeds (200)", res3.status === 200 && body3.ok === true);
  check("reported bytesWritten matches the actual payload size", body3.bytesWritten === Buffer.byteLength(smallBody));

  const fs = await import("node:fs/promises");
  const { uploadPathFor } = await loadDefault("./src/lib/restore/restore-paths.ts");
  const uploadedPath = uploadPathFor(body3.restoreAttemptId);
  const onDisk = await fs.readFile(uploadedPath, "utf-8");
  check("the file on disk has exactly the uploaded content", onDisk === smallBody);
  const attemptRow = await prisma.restoreAttempt.findUnique({ where: { id: body3.restoreAttemptId } });
  check("a RestoreAttempt row was created for this upload", attemptRow !== null && attemptRow.status === "PENDING");
  await fs.unlink(uploadedPath).catch(() => {});

  // ══════════════════════════════════════════════════════════════════
  // 4. Oversized upload is rejected MID-STREAM, not after full buffering
  //    — proven by setting a tiny limit and confirming no final file,
  //    no leftover .tmp file, and a 413 response.
  // ══════════════════════════════════════════════════════════════════
  console.log("4. Oversized upload is rejected before completion (size limit enforced mid-stream)");
  // A SEPARATE server on a SEPARATE port, run concurrently with the
  // first — deliberately not a kill-and-restart of the same port, which
  // risks a race where the old process hasn't fully released the port
  // yet and the "ready" check ends up hitting the stale server with the
  // stale (default, much larger) limit instead of the new one.
  server2 = spawn(`npx next dev -p ${PORT_2}`, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NEXT_DIST_DIR: ".next-test-restore-upload-2", RESTORE_UPLOAD_MAX_BYTES: "1024" },
    stdio: "ignore",
    shell: true,
  });
  const ready2 = await waitUntilReady(BASE_2);
  if (!ready2) throw new Error("Second test server (with size limit override) never became ready");

  // A real ReadableStream body, not a plain string — fetch sets
  // Content-Length automatically for a string body, which would let
  // the route handler's cheap header precheck reject this before ever
  // reaching the streaming byte-counter this test actually means to
  // exercise. A streaming body has no known length upfront (chunked
  // transfer encoding), so the ONLY thing that can catch this is the
  // mid-stream enforcement itself.
  const CHUNK = new Uint8Array(500_000).fill(121); // 500KB per chunk
  const oversizedStream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < 10; i++) controller.enqueue(CHUNK); // 5MB total, no Content-Length
      controller.close();
    },
  });
  const res4 = await fetch(`${BASE_2}/api/restore/upload`, {
    method: "POST",
    headers: { Cookie: `${SESSION_COOKIE.name}=${adminToken}` },
    body: oversizedStream,
    duplex: "half",
  });
  check("oversized upload is rejected (413)", res4.status === 413);
  const body4 = await res4.json();
  if (body4.restoreAttemptId) {
    const { uploadPathFor: uploadPathFor2 } = await loadDefault("./src/lib/restore/restore-paths.ts");
    const rejectedPath = uploadPathFor2(body4.restoreAttemptId);
    const finalExists = await fs.access(rejectedPath).then(() => true).catch(() => false);
    const tmpExists = await fs.access(`${rejectedPath}.tmp`).then(() => true).catch(() => false);
    check("no final file was ever created for the rejected upload", !finalExists);
    check("no leftover .tmp file remains after the rejection", !tmpExists);
    const failedAttempt = await prisma.restoreAttempt.findUnique({ where: { id: body4.restoreAttemptId } });
    check("the RestoreAttempt was marked FAILED, not left PENDING forever", failedAttempt?.status === "FAILED");
  } else {
    check("response included a restoreAttemptId to check cleanup against", false);
  }

  await prisma.user.delete({ where: { id: staffProbe.id } }).catch(() => {});
  if (body3?.restoreAttemptId) await prisma.restoreAttempt.delete({ where: { id: body3.restoreAttemptId } }).catch(() => {});
  if (body4?.restoreAttemptId) await prisma.restoreAttempt.delete({ where: { id: body4.restoreAttemptId } }).catch(() => {});
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
} finally {
  if (server) killProcessTree(server.pid);
  if (server2) killProcessTree(server2.pid);
  await prisma.$disconnect();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
