-- CreateEnum
CREATE TYPE "MeasurementMode" AS ENUM ('KAMEEZ_SHALWAR', 'COAT');

-- AlterTable
ALTER TABLE "measurement_snapshots" ADD COLUMN     "coatArmHole" DECIMAL(6,2),
ADD COLUMN     "coatBackWidth" DECIMAL(6,2),
ADD COLUMN     "coatBicep" DECIMAL(6,2),
ADD COLUMN     "coatChest" DECIMAL(6,2),
ADD COLUMN     "coatCuff" DECIMAL(6,2),
ADD COLUMN     "coatFrontLength" DECIMAL(6,2),
ADD COLUMN     "coatHipSeat" DECIMAL(6,2),
ADD COLUMN     "coatLength" DECIMAL(6,2),
ADD COLUMN     "coatNeck" DECIMAL(6,2),
ADD COLUMN     "coatShoulder" DECIMAL(6,2),
ADD COLUMN     "coatSleeve" DECIMAL(6,2),
ADD COLUMN     "coatWaist" DECIMAL(6,2),
ADD COLUMN     "waistcoatArmHole" DECIMAL(6,2),
ADD COLUMN     "waistcoatBackWidth" DECIMAL(6,2),
ADD COLUMN     "waistcoatChest" DECIMAL(6,2),
ADD COLUMN     "waistcoatFrontLength" DECIMAL(6,2),
ADD COLUMN     "waistcoatHipSeat" DECIMAL(6,2),
ADD COLUMN     "waistcoatLength" DECIMAL(6,2),
ADD COLUMN     "waistcoatNeck" DECIMAL(6,2),
ADD COLUMN     "waistcoatShoulder" DECIMAL(6,2),
ADD COLUMN     "waistcoatWaist" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "measurementMode" "MeasurementMode";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "measurementMode" "MeasurementMode" NOT NULL DEFAULT 'KAMEEZ_SHALWAR',
ALTER COLUMN "suitType" DROP NOT NULL,
ALTER COLUMN "cuffType" DROP NOT NULL,
ALTER COLUMN "gheraType" DROP NOT NULL;

-- CreateTable
CREATE TABLE "coat_measurements" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "coatLength" DECIMAL(6,2),
    "coatShoulder" DECIMAL(6,2),
    "coatChest" DECIMAL(6,2),
    "coatWaist" DECIMAL(6,2),
    "coatHipSeat" DECIMAL(6,2),
    "coatSleeve" DECIMAL(6,2),
    "coatArmHole" DECIMAL(6,2),
    "coatBicep" DECIMAL(6,2),
    "coatCuff" DECIMAL(6,2),
    "coatNeck" DECIMAL(6,2),
    "coatBackWidth" DECIMAL(6,2),
    "coatFrontLength" DECIMAL(6,2),
    "waistcoatLength" DECIMAL(6,2),
    "waistcoatShoulder" DECIMAL(6,2),
    "waistcoatChest" DECIMAL(6,2),
    "waistcoatWaist" DECIMAL(6,2),
    "waistcoatHipSeat" DECIMAL(6,2),
    "waistcoatArmHole" DECIMAL(6,2),
    "waistcoatNeck" DECIMAL(6,2),
    "waistcoatBackWidth" DECIMAL(6,2),
    "waistcoatFrontLength" DECIMAL(6,2),
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coat_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coat_measurements_customerId_key" ON "coat_measurements"("customerId");

-- AddForeignKey
ALTER TABLE "coat_measurements" ADD CONSTRAINT "coat_measurements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coat_measurements" ADD CONSTRAINT "coat_measurements_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
