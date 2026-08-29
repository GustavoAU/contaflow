-- ADR-045 · hallazgo MEDIUM de la auditoría pre-merge (2026-08-29)
--
-- `PayrollRunLine` snapshotea `conceptCode`, `conceptType`, `salarySnapshotAmount`
-- y `salarySnapshotCurrency` precisamente para no depender del catálogo vivo,
-- pero NO snapshoteaba `salaryNature`. Como la base del mes anterior (D-5) se
-- resuelve mirando la naturaleza de cada línea, reclasificar un concepto propio
-- de SALARIO_NORMAL a NO_SALARIAL reescribía retroactivamente la base de un mes
-- ya aprobado, contabilizado y declarado.
--
-- Nullable a propósito: las filas históricas de un concepto que ya no existe se
-- quedan en NULL y el código cae al catálogo vivo, que es el comportamiento de
-- hoy. Nunca peor que antes, mejor en cuanto hay snapshot.
ALTER TABLE "PayrollRunLine" ADD COLUMN IF NOT EXISTS "salaryNature" "SalaryNature";

-- Backfill por (companyId, code): es la clave natural con la que el motor
-- resolvía la naturaleza hasta ahora, así que reproduce el estado actual.
UPDATE "PayrollRunLine" l
SET "salaryNature" = c."salaryNature"
FROM "PayrollConcept" c
WHERE c."companyId" = l."companyId"
  AND c."code" = l."conceptCode"
  AND l."salaryNature" IS NULL;

-- Hallazgo MEDIUM de recursos: la consulta de horas extra del año filtra por
-- (companyId, conceptCode) y no había índice que lo sirviera — sólo
-- @@index([payrollRunId]) y el compuesto que lidera con employeeId.
CREATE INDEX IF NOT EXISTS "PayrollRunLine_companyId_conceptCode_employeeId_idx"
  ON "PayrollRunLine" ("companyId", "conceptCode", "employeeId");
