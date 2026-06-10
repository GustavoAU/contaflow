-- Hallazgo #1 auditoría integración: Retenciones sin asiento GL
-- 1. Agrega enteradoTransactionId en Retencion para separar el asiento de emisión
--    (Dr CxP / Cr Ret.X por Enterar) del asiento de enteramiento (Dr Ret.X / Cr Banco).
-- 2. Agrega islrRetentionPayableAccountId en CompanySettings para la cuenta
--    Retenciones ISLR por Pagar (Decreto 1808).

ALTER TABLE "Retencion"
  ADD COLUMN "enteradoTransactionId" TEXT REFERENCES "Transaction"("id") ON DELETE RESTRICT;

ALTER TABLE "CompanySettings"
  ADD COLUMN "islrRetentionPayableAccountId" TEXT REFERENCES "Account"("id") ON DELETE RESTRICT;
