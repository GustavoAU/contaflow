-- Fase NOM-B: Empleados, Conceptos, Feriados y Tipos de Ausencia
-- 2026-04-15

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "ContractType" AS ENUM ('INDEFINIDO', 'DETERMINADO', 'OBRA_DETERMINADA');
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED');
CREATE TYPE "ConceptType" AS ENUM ('EARNING', 'DEDUCTION');
CREATE TYPE "AbsenceCategory" AS ENUM ('JUSTIFIED', 'UNJUSTIFIED', 'MEDICAL', 'PERMISSION');

-- ─── Employee ─────────────────────────────────────────────────────────────────

CREATE TABLE "Employee" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "firstName"       TEXT NOT NULL,
  "lastName"        TEXT NOT NULL,
  "cedulaType"      TEXT NOT NULL,
  "cedulaNumber"    TEXT NOT NULL,
  "contractType"    "ContractType" NOT NULL,
  "employeeRegime"  "LottRegime" NOT NULL,
  "hireDate"        DATE NOT NULL,
  "terminationDate" DATE,
  "status"          "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "position"        TEXT NOT NULL,
  "department"      TEXT,
  "email"           TEXT,
  "phone"           TEXT,
  "bankName"        TEXT,
  "bankAccount"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Employee_companyId_cedulaType_cedulaNumber_key"
  ON "Employee"("companyId", "cedulaType", "cedulaNumber");

CREATE INDEX "Employee_companyId_status_idx"
  ON "Employee"("companyId", "status");

CREATE INDEX "Employee_companyId_lastName_firstName_idx"
  ON "Employee"("companyId", "lastName", "firstName");

-- ─── SalaryHistory ────────────────────────────────────────────────────────────

CREATE TABLE "SalaryHistory" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "employeeId"      TEXT NOT NULL,
  "effectiveFrom"   DATE NOT NULL,
  "amount"          DECIMAL(19, 4) NOT NULL,
  "currency"        "PayrollPaymentCurrency" NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalaryHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SalaryHistory"
  ADD CONSTRAINT "SalaryHistory_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SalaryHistory_employeeId_effectiveFrom_idx"
  ON "SalaryHistory"("employeeId", "effectiveFrom" DESC);

CREATE INDEX "SalaryHistory_companyId_idx"
  ON "SalaryHistory"("companyId");

-- ─── PayrollConcept ───────────────────────────────────────────────────────────

CREATE TABLE "PayrollConcept" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "type"      "ConceptType" NOT NULL,
  "isSystem"  BOOLEAN NOT NULL DEFAULT false,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayrollConcept_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PayrollConcept"
  ADD CONSTRAINT "PayrollConcept_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PayrollConcept_companyId_code_key"
  ON "PayrollConcept"("companyId", "code");

CREATE INDEX "PayrollConcept_companyId_type_isActive_idx"
  ON "PayrollConcept"("companyId", "type", "isActive");

-- ─── PublicHoliday ────────────────────────────────────────────────────────────

CREATE TABLE "PublicHoliday" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "isRecurring" BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PublicHoliday"
  ADD CONSTRAINT "PublicHoliday_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PublicHoliday_companyId_date_idx"
  ON "PublicHoliday"("companyId", "date");

-- ─── AbsenceType ─────────────────────────────────────────────────────────────

CREATE TABLE "AbsenceType" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "category"  "AbsenceCategory" NOT NULL,
  "isPaid"    BOOLEAN NOT NULL DEFAULT true,
  "isSystem"  BOOLEAN NOT NULL DEFAULT false,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AbsenceType_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AbsenceType"
  ADD CONSTRAINT "AbsenceType_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AbsenceType_companyId_isActive_idx"
  ON "AbsenceType"("companyId", "isActive");
