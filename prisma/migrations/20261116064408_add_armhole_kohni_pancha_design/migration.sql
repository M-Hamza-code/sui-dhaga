-- AlterEnum
ALTER TYPE "DesignOptionCategory" ADD VALUE 'PANCHA';

-- AlterTable
ALTER TABLE "measurement_snapshots" ADD COLUMN     "armHole" DECIMAL(6,2),
ADD COLUMN     "kohni" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "measurements" ADD COLUMN     "armHole" DECIMAL(6,2),
ADD COLUMN     "kohni" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "panchaOptionId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_panchaOptionId_fkey" FOREIGN KEY ("panchaOptionId") REFERENCES "design_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
