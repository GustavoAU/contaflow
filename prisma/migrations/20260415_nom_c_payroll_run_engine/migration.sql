-- Fase NOM-C: Motor de Cálculo de Nómina
-- 2026-04-15

-- ─── Enum ─────────────────────────────────────────────────────────────────────

CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- ─── PayrollConfig: 5 cuentas contables para asiento de causación ─────────────
-- Nullable — deben configurarse antes de permitir approve (ADR-013 Decisión 3)

ALTER TABLE "PayrollConfig"
  ADD COLUMN "expenseAccountId"      TEXT,
  ADD COLUMN "payableAccountId"      TEXT,
  ADD COLUMN "ivssPayableAccountId"  TEXT,
  ADD COLUMN "faovPayableAccountId"  TEXT,
  ADD COLUMN "incesPayableAccountId" TEXT;

ALTER TABLE "PayrollConfig"
  ADD CONSTRAINT "PayrollConfig_expenseAccountId_fkey"
    FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_payableAccountId_fkey"
    FOREIGN KEY ("payableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_ivssPayableAccountId_fkey"
    FOREIGN KEY ("ivssPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_faovPayableAccountId_fkey"
    FOREIGN KEY ("faovPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_incesPayableAccountId_fkey"
    FOREIGN KEY ("incesPayableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── PayrollRun ───────────────────────────────────────────────────────────────
-- @@unique([companyId, periodStart, periodEnd]) previene doble-proceso
-- idempotencyKey @unique previene doble submit desde UI

CREATE TABLE "PayrollRun" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "periodStart"      DATE NOT NULL,
  "periodEnd"        DATE NOT NULL,
  "status"           "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
  "totalEarnings"    DECIMAL(18,2) NOT NULL,
  "totalDeductions"  DECIMAL(18,2) NOT NULL,
  "totalNet"         DECIMAL(18,2) NOT NULL,
  "employeeCount"    INTEGER NOT NULL,
  "transactionId"    TEXT,
  "createdByUserId"  TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "cancelledByUserId" TEXT,
  "approvedAt"       TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  "idempotencyKey"   TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PayrollRun"
  ADD CONSTRAINT "PayrollRun_transactionId_key" UNIQUE ("transactionId"),
  ADD CONSTRAINT "PayrollRun_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  ADD CONSTRAINT "PayrollRun_companyId_periodStart_periodEnd_key"
    UNIQUE ("companyId", "periodStart", "periodEnd");

CREATE INDEX "PayrollRun_companyId_status_idx" ON "PayrollRun"("companyId", "status");
CREATE INDEX "PayrollRun_companyId_periodStart_idx" ON "PayrollRun"("companyId", "periodStart");

ALTER TABLE "PayrollRun"
  ADD CONSTRAINT "PayrollRun_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollRun_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── PayrollRunLine ───────────────────────────────────────────────────────────
-- Una línea = un concepto para un empleado en un run.
-- Snapshot de salario + FK de trazabilidad (ADR-013 Decisión 2).

CREATE TABLE "PayrollRunLine" (
  "id"                     TEXT NOT NULL,
  "companyId"              TEXT NOT NULL,
  "payrollRunId"           TEXT NOT NULL,
  "employeeId"             TEXT NOT NULL,
  "conceptId"              TEXT NOT NULL,
  "conceptCode"            TEXT NOT NULL,
  "conceptType"            "ConceptType" NOT NULL,
  "amount"                 DECIMAL(18,2) NOT NULL,
  "basis"                  DECIMAL(18,2),
  "hours"                  DECIMAL(8,2),
  "rate"                   DECIMAL(6,4),
  "salaryHistoryId"        TEXT,
  "salarySnapshotAmount"   DECIMAL(18,2),
  "salarySnapshotCurrency" "PayrollPaymentCurrency",
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayrollRunLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollRunLine_payrollRunId_idx" ON "PayrollRunLine"("payrollRunId");
CREATE INDEX "PayrollRunLine_companyId_employeeId_idx" ON "PayrollRunLine"("companyId", "employeeId");
CREATE INDEX "PayrollRunLine_companyId_payrollRunId_employeeId_idx"
  ON "PayrollRunLine"("companyId", "payrollRunId", "employeeId");

ALTER TABLE "PayrollRunLine"
  ADD CONSTRAINT "PayrollRunLine_payrollRunId_fkey"
    FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollRunLine_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollRunLine_conceptId_fkey"
    FOREIGN KEY ("conceptId") REFERENCES "PayrollConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
