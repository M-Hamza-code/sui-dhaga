// Backup & Restore — secure upload endpoint (Requirement 6).
//
// A Route Handler, deliberately NOT a Server Action: a Server Action's
// body arrives pre-buffered by Next.js up to its own fixed
// `experimental.serverActions.bodySizeLimit` (1MB by default in this
// app — confirmed via next.config.mjs, never overridden), which is far
// too small for a real backup file and gives no control over streaming
// or enforcing a limit mid-transfer. A Route Handler's `request.body`
// is a real, non-buffered Web Streams ReadableStream backed directly by
// the underlying Node request — this handler reads it incrementally and
// aborts the moment the configured limit is exceeded, never after
// buffering the whole thing first.
//
// Authorization happens BEFORE any byte of the body is touched — see
// getAdminSession() below, called before `request.body` is ever read.
import { NextResponse } from "next/server";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UPLOAD_DIR, uploadPathFor } from "@/lib/restore/restore-paths";

export const dynamic = "force-dynamic";

// Configurable (not a magic constant) so this exact limit-enforcement
// path is cheaply testable without actually sending hundreds of MB —
// see test-upgrade-restore-upload.mjs, which overrides it to a tiny
// value for that one purpose. Falls back to a generous real-world
// default otherwise.
function maxUploadBytes(): number {
  const override = process.env.RESTORE_UPLOAD_MAX_BYTES;
  const parsed = override ? Number(override) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200 * 1024 * 1024;
}

export async function POST(request: Request) {
  // Admin authorization BEFORE reading a single byte of the upload.
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Admin authorization required" }, { status: 403 });
  }

  if (!request.body) {
    return NextResponse.json({ error: "No request body" }, { status: 400 });
  }

  const limit = maxUploadBytes();
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > limit) {
    return NextResponse.json({ error: `File exceeds the ${limit}-byte upload limit` }, { status: 413 });
  }

  const restoreAttempt = await prisma.restoreAttempt.create({ data: { status: "PENDING", initiatedById: session.sub } });

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const finalPath = uploadPathFor(restoreAttempt.id);
  // Temporary storage (Requirement 6) + atomic file handling (Requirement
  // 9): written to a `.tmp` file first, renamed into place only once the
  // full, size-checked stream has landed on disk — a crash or a
  // rejected-for-size upload never leaves a partial file at the real path.
  const tmpPath = `${finalPath}.tmp`;

  let bytesWritten = 0;
  const nodeReadable = Readable.fromWeb(request.body as import("stream/web").ReadableStream<Uint8Array>);
  const writeStream = createWriteStream(tmpPath);

  try {
    await pipeline(
      nodeReadable,
      async function* enforceLimit(source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          bytesWritten += chunk.length;
          if (bytesWritten > limit) {
            throw new Error(`Upload exceeds the ${limit}-byte upload limit`);
          }
          yield chunk;
        }
      },
      writeStream
    );
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    const message = err instanceof Error ? err.message : "Upload failed";
    await prisma.restoreAttempt.update({ where: { id: restoreAttempt.id }, data: { status: "FAILED", errorMessage: message } });
    return NextResponse.json({ error: message, restoreAttemptId: restoreAttempt.id }, { status: 413 });
  }

  await fs.rename(tmpPath, finalPath);

  return NextResponse.json({ ok: true, restoreAttemptId: restoreAttempt.id, bytesWritten });
}
