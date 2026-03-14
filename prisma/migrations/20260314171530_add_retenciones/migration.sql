-- CreateEnum
CREATE TYPE "RetentionType" AS ENUM ('IVA', 'ISLR', 'AMBAS');

-- CreateEnum
CREATE TYPE "RetentionStatus" AS ENUM ('PENDING', 'ISSUED', 'VOIDED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "isSpecialContributor" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Retencion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerRif" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "invoiceAmount" DECIMAL(19,4) NOT NULL,
    "taxBase" DECIMAL(19,4) NOT NULL,
    "ivaAmount" DECIMAL(19,4) NOT NULL,
    "ivaRetention" DECIMAL(19,4) NOT NULL,
    "ivaRetentionPct" DECIMAL(5,2) NOT NULL,
    "islrAmount" DECIMAL(19,4),
    "islrRetentionPct" DECIMAL(5,2),
    "totalRetention" DECIMAL(19,4) NOT NULL,
    "type" "RetentionType" NOT NULL,
    "status" "RetentionStatus" NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Retencion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Retencion" ADD CONSTRAINT "Retencion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retencion" ADD CONSTRAINT "Retencion_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
