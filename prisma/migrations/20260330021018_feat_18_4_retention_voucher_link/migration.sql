-- DropForeignKey
ALTER TABLE "Retencion" DROP CONSTRAINT "Retencion_transactionId_fkey";

-- AlterTable
ALTER TABLE "Retencion" ADD COLUMN     "voucherNumber" TEXT;

-- CreateTable
CREATE TABLE "RetentionSequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetentionSequence_companyId_key" ON "RetentionSequence"("companyId");

-- AddForeignKey
ALTER TABLE "Retencion" ADD CONSTRAINT "Retencion_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionSequence" ADD CONSTRAINT "RetentionSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
