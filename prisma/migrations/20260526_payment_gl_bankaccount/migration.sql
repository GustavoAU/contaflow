-- ADR-030: Fase 38 — GL Auto-Posting de Pagos + igtfPayableAccountId
-- Migración segura: solo columnas/FK nullable + índices en columnas NULL mayoritariamente.
-- No se reescriben filas existentes. Rollback: DROP COLUMN para cada columna nueva.

-- ─── PaymentRecord: bankAccountId + glTransactionId ──────────────────────────
ALTER TABLE "PaymentRecord"
  ADD COLUMN "bankAccountId"   TEXT,
  ADD COLUMN "glTransactionId" TEXT;

ALTER TABLE "PaymentRecord"
  ADD CONSTRAINT "PaymentRecord_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentRecord_glTransactionId_fkey"
    FOREIGN KEY ("glTransactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentRecord_glTransactionId_key" UNIQUE ("glTransactionId");

CREATE INDEX "PaymentRecord_companyId_bankAccountId_idx"
  ON "PaymentRecord"("companyId", "bankAccountId");

-- ─── PaymentBatch: bankAccountId + glTransactionId ───────────────────────────
ALTER TABLE "PaymentBatch"
  ADD COLUMN "bankAccountId"   TEXT,
  ADD COLUMN "glTransactionId" TEXT;

ALTER TABLE "PaymentBatch"
  ADD CONSTRAINT "PaymentBatch_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentBatch_glTransactionId_fkey"
    FOREIGN KEY ("glTransactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentBatch_glTransactionId_key" UNIQUE ("glTransactionId");

CREATE INDEX "PaymentBatch_companyId_bankAccountId_idx"
  ON "PaymentBatch"("companyId", "bankAccountId");

-- ─── CompanySettings: igtfPayableAccountId ───────────────────────────────────
ALTER TABLE "CompanySettings"
  ADD COLUMN "igtfPayableAccountId" TEXT;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_igtfPayableAccountId_fkey"
    FOREIGN KEY ("igtfPayableAccountId") REFERENCES "Account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
