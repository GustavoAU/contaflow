-- Feature 5: frecuencia semanal de nómina
ALTER TYPE "PayrollFrequency" ADD VALUE IF NOT EXISTS 'SEMANAL';

-- Feature 8/9/10: solicitudes de vacaciones con flujo de aprobación
CREATE TYPE "VacationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "VacationRequest" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "employeeId"       TEXT NOT NULL,
  "startDate"        DATE NOT NULL,
  "endDate"          DATE NOT NULL,
  "daysRequested"    DECIMAL(5,2) NOT NULL,
  "status"           "VacationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "notes"            VARCHAR(500),
  "rejectionReason"  VARCHAR(500),
  "reviewedByUserId" TEXT,
  "reviewedAt"       TIMESTAMP(3),
  "createdByUserId"  TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VacationRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VacationRequest_companyId_fkey"  FOREIGN KEY ("companyId")  REFERENCES "Company"("id")  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VacationRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "VacationRequest_companyId_employeeId_status_idx" ON "VacationRequest"("companyId", "employeeId", "status");
CREATE INDEX "VacationRequest_companyId_status_idx"            ON "VacationRequest"("companyId", "status");

-- Feature 4: saldo inicial de vacaciones al migrar desde otro sistema
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "initialVacationDays" DECIMAL(5,2);
