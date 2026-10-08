-- DropForeignKey
ALTER TABLE "CompanySettings" DROP CONSTRAINT "CompanySettings_inventoryAccountId_fkey";

-- DropForeignKey
ALTER TABLE "CompanySettings" DROP CONSTRAINT "CompanySettings_islrRetentionPayableAccountId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_counterpartAccountId_fkey";

-- DropForeignKey
ALTER TABLE "Retencion" DROP CONSTRAINT "Retencion_enteradoTransactionId_fkey";

-- DropIndex
DROP INDEX "BenefitAdvance_companyId_idx";

-- DropIndex
DROP INDEX "CompanySettings_ivaRetentionReceivableAccountId_idx";

-- AlterTable
ALTER TABLE "AbsenceType" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerGroup" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DocShareToken" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "revokedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "workShift",
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EmployeeLoan" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "FiscalReport" ALTER COLUMN "generatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ManagedClient" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentRecord" ALTER COLUMN "ivaRetentionAmount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PayrollConcept" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PayrollRun" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VacationRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VendorGroup" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "plan_change_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropEnum
DROP TYPE "WorkShiftType";

-- CreateIndex
CREATE INDEX "Account_companyId_isPostable_idx" ON "Account"("companyId", "isPostable");

-- AddForeignKey
ALTER TABLE "Retencion" ADD CONSTRAINT "Retencion_enteradoTransactionId_fkey" FOREIGN KEY ("enteradoTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_counterpartAccountId_fkey" FOREIGN KEY ("counterpartAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_islrRetentionPayableAccountId_fkey" FOREIGN KEY ("islrRetentionPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriodMont" RENAME TO "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriod_key";

-- RenameIndex
ALTER INDEX "caja_caja_reimbursements_reimbursementNumber_key" RENAME TO "caja_caja_reimbursements_companyId_reimbursementNumber_key";
