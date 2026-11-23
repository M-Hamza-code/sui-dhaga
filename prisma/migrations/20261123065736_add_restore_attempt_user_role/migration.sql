-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "RestoreAttemptStatus" AS ENUM ('PENDING', 'VALIDATING', 'AWAITING_RESOLUTION', 'APPLYING', 'COMPLETED', 'FAILED', 'ABORTED');

-- AlterTable
ALTER TABLE "shop_settings" ADD COLUMN     "restoreGeneration" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'ADMIN';

-- CreateTable
CREATE TABLE "restore_attempts" (
    "id" TEXT NOT NULL,
    "status" "RestoreAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "initiatedById" TEXT,
    "backupFormat" TEXT,
    "backupVersion" INTEGER,
    "backupCreatedAt" TIMESTAMP(3),
    "checksum" TEXT,
    "recordCounts" JSONB,
    "safetyBackupPath" TEXT,
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "restore_attempts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "restore_attempts" ADD CONSTRAINT "restore_attempts_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
