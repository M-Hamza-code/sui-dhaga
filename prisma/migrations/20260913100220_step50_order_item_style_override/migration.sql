-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "bainType" "BainType",
ADD COLUMN     "collarType" "CollarType",
ADD COLUMN     "cuffType" "CuffType",
ADD COLUMN     "gheraType" "GheraType",
ADD COLUMN     "pocketOptionId" TEXT,
ADD COLUMN     "suitType" "SuitType";

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_pocketOptionId_fkey" FOREIGN KEY ("pocketOptionId") REFERENCES "design_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
