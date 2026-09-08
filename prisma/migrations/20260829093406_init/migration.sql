-- CreateEnum
CREATE TYPE "SuitType" AS ENUM ('SIMPLE', 'GARAM_SILAI', 'DESIGNING', 'DOUBLE_STITCH', 'BARABAR_SILAI');

-- CreateEnum
CREATE TYPE "CollarType" AS ENUM ('POINT', 'FRENCH', 'TIE');

-- CreateEnum
CREATE TYPE "BainType" AS ENUM ('FULL_BAIN', 'HALF_GOL_BAIN', 'CUT_BAIN');

-- CreateEnum
CREATE TYPE "CuffType" AS ENUM ('NOK_DAR', 'CUT', 'GOL', 'FOLD');

-- CreateEnum
CREATE TYPE "GheraType" AS ENUM ('GOL', 'SEEDHA');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'DELIVERED');

-- CreateEnum
CREATE TYPE "DesignOptionCategory" AS ENUM ('POCKET', 'PATTI');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phonePrimary" TEXT NOT NULL,
    "phoneSecondary" TEXT,
    "address" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
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
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "suitType" "SuitType" NOT NULL,
    "collarType" "CollarType" NOT NULL,
    "bainType" "BainType" NOT NULL,
    "cuffType" "CuffType" NOT NULL,
    "gheraType" "GheraType" NOT NULL,
    "pocketOptionId" TEXT,
    "pattiOptionId" TEXT,
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "balanceAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_options" (
    "id" TEXT NOT NULL,
    "category" "DesignOptionCategory" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "design_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customerCode_key" ON "customers"("customerCode");

-- CreateIndex
CREATE INDEX "customers_phonePrimary_idx" ON "customers"("phonePrimary");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_deletedAt_idx" ON "customers"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "measurements_customerId_key" ON "measurements"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_status_deliveryDate_idx" ON "orders"("status", "deliveryDate");

-- CreateIndex
CREATE INDEX "design_options_category_isActive_idx" ON "design_options"("category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "design_options_category_code_key" ON "design_options"("category", "code");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pocketOptionId_fkey" FOREIGN KEY ("pocketOptionId") REFERENCES "design_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pattiOptionId_fkey" FOREIGN KEY ("pattiOptionId") REFERENCES "design_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
