-- LOTTT Art. 183 — registro de horas extraordinarias, y la única vía de entrada
-- de horas extra a la nómina.
--
-- Hasta hoy `PayrollRunService.create` fijaba las horas en CERO en duro y no
-- existía pantalla para cargarlas: las líneas HE_DIURNA / HE_NOCTURNA nunca se
-- generaban, así que los recargos de los Arts. 117/118 y los topes del Art. 178
-- eran código inalcanzable.
--
-- El Art. 183 enumera los cuatro campos del registro (horas, trabajos efectuados,
-- trabajadores, remuneración especial pagada) y advierte que sin él "se presumen
-- ciertos, hasta prueba en contrario, los alegatos de los trabajadores": no es un
-- requisito formal, es una inversión de la carga de la prueba.

CREATE TYPE "WorkShiftType" AS ENUM ('DIURNA', 'NOCTURNA', 'MIXTA');
CREATE TYPE "OvertimeKind" AS ENUM ('DIURNA', 'NOCTURNA');

-- LOTTT Art. 173: la jornada fija el máximo diario (8 / 7 / 7,5 horas) y con él,
-- por el Art. 113, el divisor del salario hora. DIURNA por defecto: es la jornada
-- ordinaria y lo que el código asumía para todos.
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "workShift" "WorkShiftType" NOT NULL DEFAULT 'DIURNA';

CREATE TABLE IF NOT EXISTS "OvertimeEntry" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "employeeId"       TEXT NOT NULL,
  "workedOn"         DATE NOT NULL,
  "hours"            DECIMAL(6,2) NOT NULL,
  "kind"             "OvertimeKind" NOT NULL,
  "workPerformed"    VARCHAR(500) NOT NULL,
  "authorized"       BOOLEAN NOT NULL DEFAULT false,
  "authorizationRef" VARCHAR(120),
  "payrollRunId"     TEXT,
  "paidAmount"       DECIMAL(19,4),
  "createdByUserId"  TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

-- onDelete: Restrict en las tres (regla contable: nada que sustente un pago se
-- borra en cascada).
ALTER TABLE "OvertimeEntry"
  ADD CONSTRAINT "OvertimeEntry_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OvertimeEntry"
  ADD CONSTRAINT "OvertimeEntry_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OvertimeEntry"
  ADD CONSTRAINT "OvertimeEntry_payrollRunId_fkey"
  FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "OvertimeEntry_companyId_employeeId_workedOn_idx"
  ON "OvertimeEntry" ("companyId", "employeeId", "workedOn");
CREATE INDEX IF NOT EXISTS "OvertimeEntry_companyId_workedOn_idx"
  ON "OvertimeEntry" ("companyId", "workedOn");
CREATE INDEX IF NOT EXISTS "OvertimeEntry_payrollRunId_idx"
  ON "OvertimeEntry" ("payrollRunId");
CREATE INDEX IF NOT EXISTS "OvertimeEntry_employeeId_idx"
  ON "OvertimeEntry" ("employeeId");

-- ADR-007 A1-bis: modelo nuevo => ENABLE + FORCE RLS + policy company_isolation
-- con USING y WITH CHECK, en la MISMA migración. Verificable con verify-rls.mjs.
ALTER TABLE "OvertimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OvertimeEntry" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_isolation ON "OvertimeEntry";
CREATE POLICY company_isolation ON "OvertimeEntry"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "OvertimeEntry" TO authenticated;
