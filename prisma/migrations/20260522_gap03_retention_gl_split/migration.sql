-- GAP-03: Retención IVA split en GL de compra
-- Agrega ivaRetentionPayableAccountId a CompanySettings para separar
-- la cuenta de Retenciones IVA por Pagar (2110) del Proveedor (2205)
-- en los asientos de causación de facturas de compra con retención.

ALTER TABLE "CompanySettings" ADD COLUMN "ivaRetentionPayableAccountId" TEXT;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_ivaRetentionPayableAccountId_fkey"
  FOREIGN KEY ("ivaRetentionPayableAccountId")
  REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
