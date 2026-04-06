-- Fase 13C Bloque 3: Snapshots de saldos por período
-- Modelo PeriodSnapshot — saldo precalculado por cuenta al cierre de cada período contable.
-- Migration: feat_13c_period_snapshot
-- Risk: additive only — no existing rows affected, safe rollback via DROP TABLE.

CREATE TABLE "PeriodSnapshot" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "periodId"        TEXT NOT NULL,
  "accountId"       TEXT NOT NULL,
  "balanceVes"      DECIMAL(19,4) NOT NULL,
  "balanceOriginal" DECIMAL(19,4),
  "currency"        "Currency" NOT NULL DEFAULT 'VES',
  "snapshotAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PeriodSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PeriodSnapshot" ADD CONSTRAINT "PeriodSnapshot_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PeriodSnapshot" ADD CONSTRAINT "PeriodSnapshot_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PeriodSnapshot" ADD CONSTRAINT "PeriodSnapshot_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PeriodSnapshot_periodId_accountId_key" ON "PeriodSnapshot"("periodId", "accountId");

CREATE INDEX "PeriodSnapshot_companyId_periodId_idx" ON "PeriodSnapshot"("companyId", "periodId");
