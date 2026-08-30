-- PayrollRun.currencySegment — la ranura del período es (período + moneda).
--
-- Defecto que corrige: una empresa con sueldos en dos monedas está OBLIGADA a
-- procesar por separado —el calculador bloquea las mixtas— pero el segundo
-- proceso del MISMO período era imposible por dos frenos independientes:
--   1. El guard de solapamiento de PayrollRunService.create no filtraba por
--      empleado: veía el primer run y rechazaba el segundo aunque llevara gente
--      distinta.
--   2. El índice único parcial `PayrollRun_companyId_period_active_key` permitía
--      una sola fila vigente por período.
-- Resultado: se podía pagar a UN grupo de moneda y el otro quedaba sin cobrar
-- ese período. El selector de empleados dejaba elegir la moneda y luego el
-- servicio rechazaba el segundo proceso.
--
-- La unicidad correcta no es "un proceso por período" sino "un proceso VIGENTE
-- por período Y MONEDA". El invariante real —que un trabajador no cobre dos
-- veces por períodos solapados— lo hace cumplir el guard aplicativo, que pasa a
-- comparar los EMPLEADOS de los runs solapados (ADR-044: el aislamiento y los
-- invariantes de negocio son aplicativos; la RLS no los cubre).

ALTER TABLE "PayrollRun"
  ADD COLUMN IF NOT EXISTS "currencySegment" "PayrollPaymentCurrency" NOT NULL DEFAULT 'VES';

-- Backfill: la moneda real de cada run vive en el snapshot de sus líneas. Los
-- runs sin líneas (no debería haberlos) se quedan en el default.
UPDATE "PayrollRun" r
   SET "currencySegment" = sub.cur
  FROM (
    SELECT DISTINCT ON ("payrollRunId") "payrollRunId", "salarySnapshotCurrency" AS cur
      FROM "PayrollRunLine"
     WHERE "salarySnapshotCurrency" IS NOT NULL
     ORDER BY "payrollRunId", "id"
  ) AS sub
 WHERE sub."payrollRunId" = r."id"
   AND sub.cur IS NOT NULL;

-- Sustituir el único parcial por el que incluye el segmento.
DROP INDEX IF EXISTS "PayrollRun_companyId_period_active_key";

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_companyId_period_segment_active_key"
  ON "PayrollRun" ("companyId", "periodStart", "periodEnd", "currencySegment")
  WHERE status <> 'CANCELLED';
