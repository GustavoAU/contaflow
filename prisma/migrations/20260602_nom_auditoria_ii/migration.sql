-- Auditoría Parte II — 2026-06-02
-- Employee: useFideicomiso — fideicomiso bancario individual por trabajador (LOTTT Art. 143 parte final)
-- BenefitBalance: initialBalance + initialInterestBalance — saldo previo al sistema para migración de datos

ALTER TABLE "Employee"
  ADD COLUMN "useFideicomiso" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BenefitBalance"
  ADD COLUMN "initialBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "initialInterestBalance" DECIMAL(19,4) NOT NULL DEFAULT 0;
