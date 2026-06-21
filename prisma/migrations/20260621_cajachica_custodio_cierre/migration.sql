-- Migration: 20260621_cajachica_custodio_cierre
-- Fase 2 Caja Chica (ADR-036): custodio (HC-03) + asiento de liquidación al cierre (HC-05).
-- Idempotente y no destructiva (re-ejecutable).

-- ─── HC-03: custodio (FK a Employee, nullable, Restrict) ─────────────────────

ALTER TABLE "caja_cajas" ADD COLUMN IF NOT EXISTS "custodianId" TEXT;

ALTER TABLE "caja_cajas" DROP CONSTRAINT IF EXISTS "caja_cajas_custodianId_fkey";
ALTER TABLE "caja_cajas"
  ADD CONSTRAINT "caja_cajas_custodianId_fkey"
  FOREIGN KEY ("custodianId") REFERENCES "Employee"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "caja_cajas_companyId_custodianId_idx"
  ON "caja_cajas" ("companyId", "custodianId");

-- ─── HC-05: asiento de liquidación al cierre (FK a Transaction, nullable, unique, Restrict) ──

ALTER TABLE "caja_cajas" ADD COLUMN IF NOT EXISTS "closeTransactionId" TEXT;

DROP INDEX IF EXISTS "caja_cajas_closeTransactionId_key";
CREATE UNIQUE INDEX "caja_cajas_closeTransactionId_key"
  ON "caja_cajas" ("closeTransactionId");

ALTER TABLE "caja_cajas" DROP CONSTRAINT IF EXISTS "caja_cajas_closeTransactionId_fkey";
ALTER TABLE "caja_cajas"
  ADD CONSTRAINT "caja_cajas_closeTransactionId_fkey"
  FOREIGN KEY ("closeTransactionId") REFERENCES "Transaction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
