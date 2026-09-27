-- ADR-055: Ejercicio Fiscal Anual — FiscalYear + fiscalYearStartMonth + FKs
-- Pre-flight OBLIGATORIO antes de aplicar en prod:
--   SELECT count(*) FROM "Company";
--   SELECT count(*) FROM "AccountingPeriod";
--   SELECT count(*) FROM "FiscalYearClose";

ALTER TABLE "Company" ADD COLUMN "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Company" ADD CONSTRAINT "company_fiscal_year_start_month_range"
  CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12);

CREATE TABLE "FiscalYear" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "year"       INTEGER NOT NULL,
  "startMonth" INTEGER NOT NULL,
  "status"     "PeriodStatus" NOT NULL DEFAULT 'OPEN',
  "openedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openedBy"   TEXT NOT NULL,
  "closedAt"   TIMESTAMP(3),
  "closedBy"   TEXT,
  CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiscalYear" ADD CONSTRAINT "fiscal_year_start_month_range"
  CHECK ("startMonth" BETWEEN 1 AND 12);

CREATE UNIQUE INDEX "FiscalYear_companyId_year_key" ON "FiscalYear"("companyId", "year");
CREATE INDEX "FiscalYear_companyId_status_idx" ON "FiscalYear"("companyId", "status");

-- RLS (ADR-007 A1-bis / ADR-044) — misma migración, no diferir.
ALTER TABLE "FiscalYear" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalYear" FORCE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON "FiscalYear"
  USING ("companyId" = current_setting('app.current_company_id', true))
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true));

-- AccountingPeriod: agrupación al ejercicio (nullable durante backfill — ver Fase 2).
ALTER TABLE "AccountingPeriod" ADD COLUMN "fiscalYearId" TEXT;
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey"
  FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AccountingPeriod_companyId_fiscalYearId_idx" ON "AccountingPeriod"("companyId", "fiscalYearId");

-- H-1: hacer explícito el onDelete de AccountingPeriod.company (antes ausente).
-- Verificado con npm run verify:drift que esto NO es un DROP silencioso de índice/constraint
-- (es un FK plano sin índice único asociado — recrearlo con la misma definición es seguro).
ALTER TABLE "AccountingPeriod" DROP CONSTRAINT IF EXISTS "AccountingPeriod_companyId_fkey";
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FiscalYearClose: FK explícito al ejercicio (nullable durante backfill — ver Fase 2).
ALTER TABLE "FiscalYearClose" ADD COLUMN "fiscalYearId" TEXT;
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_fiscalYearId_fkey"
  FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "FiscalYearClose_fiscalYearId_key" ON "FiscalYearClose"("fiscalYearId");
