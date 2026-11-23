-- CreateEnum
CREATE TYPE "CoatGarmentSelection" AS ENUM ('PRINCE_COAT', 'WAISTCOAT', 'BOTH');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "coatGarmentSelection" "CoatGarmentSelection";
