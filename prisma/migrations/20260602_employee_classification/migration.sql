-- Auditoría 2026-06-02: clasificación LOTTT Art. 1 + estado civil ISLR D.1808 + fecha vencimiento contrato
-- maritalStatus: opcional, para retenciones ISLR con cargas familiares
-- payrollWorkerType: NOT NULL DEFAULT EMPLEADO — diferencia obrero/empleado para aportes IVSS/LSSO
-- contractEndDate: fecha estimada de vencimiento para contratos DETERMINADO (LOTTT Art. 64)

CREATE TYPE "MaritalStatus" AS ENUM ('SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'UNION_ESTABLE');
CREATE TYPE "PayrollWorkerType" AS ENUM ('OBRERO', 'EMPLEADO');

ALTER TABLE "Employee"
  ADD COLUMN "maritalStatus" "MaritalStatus",
  ADD COLUMN "payrollWorkerType" "PayrollWorkerType" NOT NULL DEFAULT 'EMPLEADO',
  ADD COLUMN "contractEndDate" DATE;
