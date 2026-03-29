-- AlterTable: add invoiceId, idempotencyKey, deletedAt to Retencion
ALTER TABLE "Retencion" ADD COLUMN "invoiceId" TEXT;
ALTER TABLE "Retencion" ADD COLUMN "idempotencyKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Retencion" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Populate idempotencyKey with unique values for existing rows (use existing id as seed)
UPDATE "Retencion" SET "idempotencyKey" = id WHERE "idempotencyKey" = '';

-- Remove default now that existing rows are populated
ALTER TABLE "Retencion" ALTER COLUMN "idempotencyKey" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Retencion_idempotencyKey_key" ON "Retencion"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Retencion_companyId_idx" ON "Retencion"("companyId");

-- CreateIndex
CREATE INDEX "Retencion_invoiceId_idx" ON "Retencion"("invoiceId");

-- CreateIndex
CREATE INDEX "Retencion_companyId_invoiceId_idx" ON "Retencion"("companyId", "invoiceId");

-- AddForeignKey
ALTER TABLE "Retencion" ADD CONSTRAINT "Retencion_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
