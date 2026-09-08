import { Prisma } from "@prisma/client";

// Extracted (Step 25) into its own plain module — a "use server" file's
// exports must all be async Server Actions, and this is a synchronous
// helper both order-actions.ts and the combined new-customer+order
// action (customer-order-actions.ts) need to share rather than duplicate.
export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
