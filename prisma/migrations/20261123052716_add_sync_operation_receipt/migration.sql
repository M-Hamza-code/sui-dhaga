-- CreateTable
CREATE TABLE "sync_operation_receipts" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operation_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_operation_receipts_operationId_key" ON "sync_operation_receipts"("operationId");
