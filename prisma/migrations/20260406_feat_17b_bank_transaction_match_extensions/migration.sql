-- Fase 17B: Extender BankTransaction con 2 FK opcionales de match
-- Opción D (ADR-008): mantener BankTransaction, añadir matchedTransactionId + matchedPaymentRecordId
-- Eliminar matchedJournalEntryId (placeholder sin FK de Fase 17)

-- Drop placeholder field (sin datos, sin FK)
ALTER TABLE "BankTransaction" DROP COLUMN IF EXISTS "matchedJournalEntryId";

-- Añadir match tipo 2: Transaction (asiento libro mayor)
ALTER TABLE "BankTransaction" ADD COLUMN "matchedTransactionId" TEXT;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedTransactionId_fkey"
  FOREIGN KEY ("matchedTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BankTransaction_matchedTransactionId_idx" ON "BankTransaction"("matchedTransactionId");

-- Añadir match tipo 3: PaymentRecord (pago multi-medio digital)
ALTER TABLE "BankTransaction" ADD COLUMN "matchedPaymentRecordId" TEXT;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedPaymentRecordId_fkey"
  FOREIGN KEY ("matchedPaymentRecordId") REFERENCES "PaymentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BankTransaction_matchedPaymentRecordId_idx" ON "BankTransaction"("matchedPaymentRecordId");
