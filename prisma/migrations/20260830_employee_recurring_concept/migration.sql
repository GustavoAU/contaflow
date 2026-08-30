-- EmployeeRecurringConcept — asignaciones/deducciones fijas por trabajador.
--
-- Motivo: la nomina venezolana real paga el salario en bolivares (base de las
-- cotizaciones y lo que se declara) y el resto en dolares como bono NO salarial.
-- Eso solo podia expresarse con `manualConcepts`, que hay que reescribir empleado
-- por empleado en cada quincena y que ademas ninguna pantalla envia.
--
-- Ademas, trazabilidad del importe pactado en otra moneda (ADR-045 D-3): la linea
-- guarda el original y la tasa aplicada, para poder reconstruir el calculo en una
-- fiscalizacion aunque la tasa haya cambiado.

CREATE TABLE IF NOT EXISTS "EmployeeRecurringConcept" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "employeeId"      TEXT NOT NULL,
  "conceptId"       TEXT NOT NULL,
  "amount"          DECIMAL(19,4) NOT NULL,
  "currency"        "PayrollPaymentCurrency" NOT NULL,
  "effectiveFrom"   DATE NOT NULL,
  "effectiveTo"     DATE,
  "notes"           VARCHAR(300),
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeRecurringConcept_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmployeeRecurringConcept"
  DROP CONSTRAINT IF EXISTS "EmployeeRecurringConcept_companyId_fkey";
ALTER TABLE "EmployeeRecurringConcept"
  ADD CONSTRAINT "EmployeeRecurringConcept_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeRecurringConcept"
  DROP CONSTRAINT IF EXISTS "EmployeeRecurringConcept_employeeId_fkey";
ALTER TABLE "EmployeeRecurringConcept"
  ADD CONSTRAINT "EmployeeRecurringConcept_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeRecurringConcept"
  DROP CONSTRAINT IF EXISTS "EmployeeRecurringConcept_conceptId_fkey";
ALTER TABLE "EmployeeRecurringConcept"
  ADD CONSTRAINT "EmployeeRecurringConcept_conceptId_fkey"
  FOREIGN KEY ("conceptId") REFERENCES "PayrollConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "EmployeeRecurringConcept_companyId_employeeId_effectiveFrom_idx"
  ON "EmployeeRecurringConcept" ("companyId", "employeeId", "effectiveFrom" DESC);
CREATE INDEX IF NOT EXISTS "EmployeeRecurringConcept_companyId_conceptId_idx"
  ON "EmployeeRecurringConcept" ("companyId", "conceptId");
CREATE INDEX IF NOT EXISTS "EmployeeRecurringConcept_employeeId_idx"
  ON "EmployeeRecurringConcept" ("employeeId");

-- ADR-007 A1-bis: RLS en la MISMA migracion que crea el modelo.
ALTER TABLE "EmployeeRecurringConcept" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeRecurringConcept" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_isolation ON "EmployeeRecurringConcept";
CREATE POLICY company_isolation ON "EmployeeRecurringConcept"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "EmployeeRecurringConcept" TO authenticated;

-- ADR-045 D-3: trazabilidad de la conversion en la linea de nomina.
ALTER TABLE "PayrollRunLine" ADD COLUMN IF NOT EXISTS "originalAmount"      DECIMAL(19,4);
ALTER TABLE "PayrollRunLine" ADD COLUMN IF NOT EXISTS "originalCurrency"    "PayrollPaymentCurrency";
ALTER TABLE "PayrollRunLine" ADD COLUMN IF NOT EXISTS "exchangeRateApplied" DECIMAL(19,8);
