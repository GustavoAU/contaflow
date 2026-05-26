-- Riesgo-9 (Art. 33 COT): COBRO y PAGO en TransactionType para identificación correcta
-- de operaciones en Libro Diario / Libro Mayor. ALTER TYPE no puede ir en BEGIN..COMMIT.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'COBRO';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'PAGO';

-- Riesgo-6 (Prov. 0049 Art. 1): IVA retenido por cliente CE en cobros (75%/100%).
-- El campo permite registrar Dr. IVA Ret. x Cobrar = Cr. CxC (diferencia vs efectivo recibido).
ALTER TABLE "PaymentRecord"
  ADD COLUMN IF NOT EXISTS "ivaRetentionAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- Riesgo-6: Cuenta GL "IVA Retenido por Cobrar" (ACTIVO) en configuración de empresa.
ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "ivaRetentionReceivableAccountId" TEXT;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_ivaRetentionReceivableAccountId_fkey"
  FOREIGN KEY ("ivaRetentionReceivableAccountId")
  REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS "CompanySettings_ivaRetentionReceivableAccountId_idx"
  ON "CompanySettings"("ivaRetentionReceivableAccountId");
