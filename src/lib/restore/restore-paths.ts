import path from "path";

// Shared between restore-actions.ts ("use server" — can only export
// async functions, so these plain helpers live here instead) and
// /api/restore/upload/route.ts.

export const UPLOAD_DIR = path.join(process.cwd(), "var", "restore-uploads");

export function uploadPathFor(restoreAttemptId: string): string {
  return path.join(UPLOAD_DIR, `${restoreAttemptId}.json`);
}
