import { PrismaClient } from "@prisma/client";

// Reusable Prisma Client singleton.
//
// In Next.js dev mode, modules can be re-evaluated on every hot reload,
// which would otherwise create a new PrismaClient (and a new DB connection
// pool) on every save. We cache the instance on `globalThis` in
// non-production environments to avoid exhausting the connection pool.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
