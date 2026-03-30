/*
  Warnings:

  - The `currency` column on the `IGTFTransaction` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('VES', 'USD', 'EUR');

-- AlterTable
ALTER TABLE "IGTFTransaction" DROP COLUMN "currency",
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'VES',
ADD COLUMN     "exchangeRateId" TEXT;

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "rate" DECIMAL(19,6) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BCV',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_companyId_currency_date_idx" ON "ExchangeRate"("companyId", "currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_companyId_currency_date_key" ON "ExchangeRate"("companyId", "currency", "date");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
