-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'NEW';
ALTER TYPE "OrderStatus" ADD VALUE 'STITCHING';
ALTER TYPE "OrderStatus" ADD VALUE 'READY';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "defaultMeasurementSnapshotId" TEXT;

-- CreateTable
CREATE TABLE "measurement_snapshots" (
    "id" TEXT NOT NULL,
    "length" DECIMAL(6,2),
    "shoulder" DECIMAL(6,2),
    "sleeve" DECIMAL(6,2),
    "neck" DECIMAL(6,2),
    "chest" DECIMAL(6,2),
    "waist" DECIMAL(6,2),
    "hem" DECIMAL(6,2),
    "shalwarLength" DECIMAL(6,2),
    "pancha" DECIMAL(6,2),
    "shalwarPocket" BOOLEAN,
    "shalwarGheraReady" DECIMAL(6,2),
    "note" TEXT,
    "isBackfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "measurementSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_settings" (
    "id" TEXT NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "tagline" TEXT,
    "defaultPrices" JSONB NOT NULL DEFAULT '{}',
    "defaultAdvancePercent" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_items_measurementSnapshotId_key" ON "order_items"("measurementSnapshotId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_position_key" ON "order_items"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "shop_settings_singleton_key" ON "shop_settings"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "orders_defaultMeasurementSnapshotId_key" ON "orders"("defaultMeasurementSnapshotId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_defaultMeasurementSnapshotId_fkey" FOREIGN KEY ("defaultMeasurementSnapshotId") REFERENCES "measurement_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_measurementSnapshotId_fkey" FOREIGN KEY ("measurementSnapshotId") REFERENCES "measurement_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

