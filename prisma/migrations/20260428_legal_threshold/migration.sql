-- Ítem 72: Histórico de topes legales venezolanos por empresa
-- LegalThreshold almacena salario mínimo y UT con fecha de vigencia.
-- PayrollRunService consulta el tope vigente a la fecha del período calculado.

CREATE TYPE "LegalThresholdType" AS ENUM ('SALARY_MIN_VES', 'UT_VALUE');

CREATE TABLE "LegalThreshold" (
  "id"            TEXT        NOT NULL,
  "companyId"     TEXT        NOT NULL,
  "type"          "LegalThresholdType" NOT NULL,
  "effectiveFrom" DATE        NOT NULL,
  "value"         DECIMAL(18,2) NOT NULL,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LegalThreshold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalThreshold_companyId_type_effectiveFrom_key"
  ON "LegalThreshold"("companyId", "type", "effectiveFrom");

CREATE INDEX "LegalThreshold_companyId_type_effectiveFrom_idx"
  ON "LegalThreshold"("companyId", "type", "effectiveFrom");

ALTER TABLE "LegalThreshold"
  ADD CONSTRAINT "LegalThreshold_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
