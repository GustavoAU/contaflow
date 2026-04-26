-- Migration: nom_d_advance_bcv_ratetype_additional_days
-- Fecha: 2026-04-22
-- Cambios:
--   1. enum BcvRateType (ACTIVA, PROMEDIO) + campo rateType en BcvBenefitRate
--   2. Campo additionalDays DECIMAL(5,2) en BenefitAccrualLine
--   3. enum BenefitAdvanceReason (HOUSING, HEALTH, EDUCATION)
--   4. Modelo BenefitAdvance + índices

-- 1. Enum BcvRateType
CREATE TYPE "BcvRateType" AS ENUM ('ACTIVA', 'PROMEDIO');

-- 2. rateType en BcvBenefitRate (default ACTIVA)
ALTER TABLE "BcvBenefitRate"
  ADD COLUMN "rateType" "BcvRateType" NOT NULL DEFAULT 'ACTIVA';

-- 3. additionalDays en BenefitAccrualLine (nullable)
ALTER TABLE "BenefitAccrualLine"
  ADD COLUMN "additionalDays" DECIMAL(5,2);

-- 4. Enum BenefitAdvanceReason
CREATE TYPE "BenefitAdvanceReason" AS ENUM ('HOUSING', 'HEALTH', 'EDUCATION');

-- 5. Tabla BenefitAdvance
CREATE TABLE "BenefitAdvance" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "employeeId"       TEXT NOT NULL,
  "benefitBalanceId" TEXT NOT NULL,
  "amount"           DECIMAL(19,4) NOT NULL,
  "reason"           "BenefitAdvanceReason" NOT NULL,
  "notes"            TEXT,
  "transactionId"    TEXT,
  "createdByUserId"  TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BenefitAdvance_pkey" PRIMARY KEY ("id")
);

-- 6. Unique constraint on transactionId
ALTER TABLE "BenefitAdvance"
  ADD CONSTRAINT "BenefitAdvance_transactionId_key" UNIQUE ("transactionId");

-- 7. Índices
CREATE INDEX "BenefitAdvance_companyId_employeeId_idx" ON "BenefitAdvance"("companyId", "employeeId");
CREATE INDEX "BenefitAdvance_companyId_idx" ON "BenefitAdvance"("companyId");

-- 8. Foreign keys
ALTER TABLE "BenefitAdvance"
  ADD CONSTRAINT "BenefitAdvance_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BenefitAdvance"
  ADD CONSTRAINT "BenefitAdvance_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BenefitAdvance"
  ADD CONSTRAINT "BenefitAdvance_benefitBalanceId_fkey"
    FOREIGN KEY ("benefitBalanceId") REFERENCES "BenefitBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BenefitAdvance"
  ADD CONSTRAINT "BenefitAdvance_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
