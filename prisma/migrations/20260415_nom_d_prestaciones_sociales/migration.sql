-- Migration: nom_d_prestaciones_sociales
-- Fase NOM-D: Prestaciones Sociales, Vacaciones, Utilidades, Liquidación Final LOTTT
-- ADR-014

-- ─── Enums NOM-D ─────────────────────────────────────────────────────────────

CREATE TYPE "BenefitAccrualType" AS ENUM ('QUARTERLY_ACCRUAL', 'BCV_INTEREST', 'ADJUSTMENT');
CREATE TYPE "TerminationStatus" AS ENUM ('DRAFT', 'FINALIZING', 'FINALIZED');
CREATE TYPE "TerminationReason" AS ENUM (
  'RESIGNATION',
  'DISMISSAL_JUSTIFIED',
  'DISMISSAL_UNJUSTIFIED',
  'MUTUAL_AGREEMENT',
  'CONTRACT_EXPIRY',
  'DEATH',
  'DISABILITY'
);

-- ─── Extensión PayrollConfig: cuentas NOM-D + configuración beneficios ────────

ALTER TABLE "PayrollConfig"
  ADD COLUMN "benefitsExpenseAccountId"      TEXT,
  ADD COLUMN "benefitsPayableAccountId"      TEXT,
  ADD COLUMN "vacationPayableAccountId"      TEXT,
  ADD COLUMN "profitSharingPayableAccountId" TEXT,
  ADD COLUMN "profitDays"                    INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "vacationBonusDays"             INTEGER NOT NULL DEFAULT 7;

-- FKs PayrollConfig → Account (NOM-D)
ALTER TABLE "PayrollConfig"
  ADD CONSTRAINT "PayrollConfig_benefitsExpenseAccountId_fkey"
    FOREIGN KEY ("benefitsExpenseAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_benefitsPayableAccountId_fkey"
    FOREIGN KEY ("benefitsPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_vacationPayableAccountId_fkey"
    FOREIGN KEY ("vacationPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_profitSharingPayableAccountId_fkey"
    FOREIGN KEY ("profitSharingPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── BcvBenefitRate ───────────────────────────────────────────────────────────

CREATE TABLE "BcvBenefitRate" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "year"            INTEGER NOT NULL,
  "month"           INTEGER NOT NULL,
  "annualRate"      DECIMAL(5,2) NOT NULL,
  "source"          TEXT NOT NULL DEFAULT 'BCV',
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BcvBenefitRate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BcvBenefitRate"
  ADD CONSTRAINT "BcvBenefitRate_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "BcvBenefitRate_companyId_year_month_key" ON "BcvBenefitRate"("companyId", "year", "month");
CREATE INDEX "BcvBenefitRate_companyId_year_month_idx" ON "BcvBenefitRate"("companyId", "year", "month");

-- ─── BenefitBalance ───────────────────────────────────────────────────────────

CREATE TABLE "BenefitBalance" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "employeeId"      TEXT NOT NULL,
  "currentBalance"  DECIMAL(19,4) NOT NULL DEFAULT 0,
  "interestBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "isLiquidated"    BOOLEAN NOT NULL DEFAULT false,
  "liquidatedAt"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BenefitBalance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BenefitBalance"
  ADD CONSTRAINT "BenefitBalance_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BenefitBalance_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "BenefitBalance_employeeId_key" ON "BenefitBalance"("employeeId");
CREATE INDEX "BenefitBalance_companyId_idx" ON "BenefitBalance"("companyId");
CREATE INDEX "BenefitBalance_companyId_isLiquidated_idx" ON "BenefitBalance"("companyId", "isLiquidated");

-- ─── BenefitAccrualLine ───────────────────────────────────────────────────────

CREATE TABLE "BenefitAccrualLine" (
  "id"                       TEXT NOT NULL,
  "companyId"                TEXT NOT NULL,
  "benefitBalanceId"         TEXT NOT NULL,
  "type"                     "BenefitAccrualType" NOT NULL,
  "year"                     INTEGER NOT NULL,
  "quarter"                  INTEGER,
  "month"                    INTEGER,
  "dailyNormalWage"          DECIMAL(19,4),
  "profitDaysAliquot"        DECIMAL(19,4),
  "vacationBonusDaysAliquot" DECIMAL(19,4),
  "integralDailyWage"        DECIMAL(19,4),
  "accrualDays"              INTEGER,
  "accrualAmount"            DECIMAL(19,4) NOT NULL,
  "runningBalance"           DECIMAL(19,4) NOT NULL,
  "bcvRateId"                TEXT,
  "appliedRate"              DECIMAL(5,2),
  "transactionId"            TEXT,
  "notes"                    TEXT,
  "createdByUserId"          TEXT NOT NULL,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BenefitAccrualLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BenefitAccrualLine"
  ADD CONSTRAINT "BenefitAccrualLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BenefitAccrualLine_benefitBalanceId_fkey"
    FOREIGN KEY ("benefitBalanceId") REFERENCES "BenefitBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BenefitAccrualLine_bcvRateId_fkey"
    FOREIGN KEY ("bcvRateId") REFERENCES "BcvBenefitRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BenefitAccrualLine_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard doble-accrual trimestral (ADR-014 Dec. 1)
CREATE UNIQUE INDEX "BenefitAccrualLine_benefitBalanceId_year_quarter_type_key"
  ON "BenefitAccrualLine"("benefitBalanceId", "year", "quarter", "type");
CREATE UNIQUE INDEX "BenefitAccrualLine_transactionId_key" ON "BenefitAccrualLine"("transactionId");
CREATE INDEX "BenefitAccrualLine_companyId_idx" ON "BenefitAccrualLine"("companyId");
CREATE INDEX "BenefitAccrualLine_benefitBalanceId_createdAt_idx" ON "BenefitAccrualLine"("benefitBalanceId", "createdAt" DESC);
CREATE INDEX "BenefitAccrualLine_companyId_year_quarter_idx" ON "BenefitAccrualLine"("companyId", "year", "quarter");

-- ─── VacationRecord ───────────────────────────────────────────────────────────

CREATE TABLE "VacationRecord" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "employeeId"      TEXT NOT NULL,
  "periodYear"      INTEGER NOT NULL,
  "vacationDays"    DECIMAL(5,2) NOT NULL,
  "bonusDays"       DECIMAL(5,2) NOT NULL,
  "dailyNormalWage" DECIMAL(19,4) NOT NULL,
  "vacationAmount"  DECIMAL(19,4) NOT NULL,
  "bonusAmount"     DECIMAL(19,4) NOT NULL,
  "startDate"       DATE NOT NULL,
  "endDate"         DATE NOT NULL,
  "isFractional"    BOOLEAN NOT NULL DEFAULT false,
  "transactionId"   TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VacationRecord_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VacationRecord"
  ADD CONSTRAINT "VacationRecord_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "VacationRecord_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "VacationRecord_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "VacationRecord_companyId_employeeId_periodYear_isFractional_key"
  ON "VacationRecord"("companyId", "employeeId", "periodYear", "isFractional");
CREATE UNIQUE INDEX "VacationRecord_transactionId_key" ON "VacationRecord"("transactionId");
CREATE INDEX "VacationRecord_companyId_employeeId_idx" ON "VacationRecord"("companyId", "employeeId");
CREATE INDEX "VacationRecord_companyId_periodYear_idx" ON "VacationRecord"("companyId", "periodYear");

-- ─── ProfitSharingRecord ──────────────────────────────────────────────────────

CREATE TABLE "ProfitSharingRecord" (
  "id"                  TEXT NOT NULL,
  "companyId"           TEXT NOT NULL,
  "employeeId"          TEXT NOT NULL,
  "fiscalYear"          INTEGER NOT NULL,
  "profitDays"          DECIMAL(5,2) NOT NULL,
  "fractionalDays"      DECIMAL(5,2) NOT NULL,
  "monthsWorked"        INTEGER NOT NULL,
  "baseSalarySnapshot"  DECIMAL(19,4) NOT NULL,
  "profitAmount"        DECIMAL(19,4) NOT NULL,
  "isFractional"        BOOLEAN NOT NULL DEFAULT false,
  "transactionId"       TEXT,
  "createdByUserId"     TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProfitSharingRecord_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProfitSharingRecord"
  ADD CONSTRAINT "ProfitSharingRecord_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProfitSharingRecord_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProfitSharingRecord_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProfitSharingRecord_companyId_employeeId_fiscalYear_isFractional_key"
  ON "ProfitSharingRecord"("companyId", "employeeId", "fiscalYear", "isFractional");
CREATE UNIQUE INDEX "ProfitSharingRecord_transactionId_key" ON "ProfitSharingRecord"("transactionId");
CREATE INDEX "ProfitSharingRecord_companyId_employeeId_idx" ON "ProfitSharingRecord"("companyId", "employeeId");
CREATE INDEX "ProfitSharingRecord_companyId_fiscalYear_idx" ON "ProfitSharingRecord"("companyId", "fiscalYear");

-- ─── Termination ─────────────────────────────────────────────────────────────

CREATE TABLE "Termination" (
  "id"                            TEXT NOT NULL,
  "companyId"                     TEXT NOT NULL,
  "employeeId"                    TEXT NOT NULL,
  "reason"                        "TerminationReason" NOT NULL,
  "status"                        "TerminationStatus" NOT NULL DEFAULT 'DRAFT',
  "terminationDate"               DATE NOT NULL,
  "benefitBalanceId"              TEXT,
  "benefitsAccumulatedAmount"     DECIMAL(19,4) NOT NULL DEFAULT 0,
  "benefitsInterestAmount"        DECIMAL(19,4) NOT NULL DEFAULT 0,
  "vacationFractionalDays"        DECIMAL(5,2) NOT NULL DEFAULT 0,
  "vacationFractionalAmount"      DECIMAL(19,4) NOT NULL DEFAULT 0,
  "vacationBonusFractionalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "profitSharingFractionalDays"   DECIMAL(5,2) NOT NULL DEFAULT 0,
  "profitSharingFractionalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "profitSharingBaseSalary"       DECIMAL(19,4),
  "indemnificationAmount"         DECIMAL(19,4) NOT NULL DEFAULT 0,
  "pendingConceptsAmount"         DECIMAL(19,4) NOT NULL DEFAULT 0,
  "pendingConceptsNotes"          TEXT,
  "totalGrossAmount"              DECIMAL(19,4) NOT NULL DEFAULT 0,
  "deductionsAmount"              DECIMAL(19,4) NOT NULL DEFAULT 0,
  "totalNetAmount"                DECIMAL(19,4) NOT NULL DEFAULT 0,
  "transactionId"                 TEXT,
  "idempotencyKey"                TEXT NOT NULL,
  "createdByUserId"               TEXT NOT NULL,
  "finalizedByUserId"             TEXT,
  "finalizedAt"                   TIMESTAMP(3),
  "deletedAt"                     TIMESTAMP(3),
  "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Termination_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Termination"
  ADD CONSTRAINT "Termination_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Termination_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Termination_benefitBalanceId_fkey"
    FOREIGN KEY ("benefitBalanceId") REFERENCES "BenefitBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Termination_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Termination_benefitBalanceId_key" ON "Termination"("benefitBalanceId");
CREATE UNIQUE INDEX "Termination_transactionId_key" ON "Termination"("transactionId");
CREATE UNIQUE INDEX "Termination_idempotencyKey_key" ON "Termination"("idempotencyKey");
CREATE INDEX "Termination_companyId_employeeId_idx" ON "Termination"("companyId", "employeeId");
CREATE INDEX "Termination_companyId_status_idx" ON "Termination"("companyId", "status");
CREATE INDEX "Termination_companyId_terminationDate_idx" ON "Termination"("companyId", "terminationDate" DESC);
