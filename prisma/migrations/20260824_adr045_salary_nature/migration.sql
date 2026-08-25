-- ADR-045 D-1: la naturaleza salarial de un concepto es ternaria.
-- Un booleano no puede representarla: las horas extraordinarias SON salario
-- (LOTTT Art. 104) pero NO son salario normal (mismo articulo, tercer aparte).

CREATE TYPE "SalaryNature" AS ENUM ('NO_SALARIAL', 'SALARIO_NORMAL', 'SALARIAL_ACCIDENTAL');

ALTER TABLE "PayrollConcept"
  ADD COLUMN "salaryNature" "SalaryNature" NOT NULL DEFAULT 'SALARIO_NORMAL';

-- Backfill mecanico desde el booleano deprecado.
UPDATE "PayrollConcept" SET "salaryNature" = 'NO_SALARIAL'
  WHERE "affectsSalaryIntegral" = false;

UPDATE "PayrollConcept" SET "salaryNature" = 'SALARIO_NORMAL'
  WHERE "affectsSalaryIntegral" = true;

-- El mapeo automatico NO puede inferir los accidentales, y se equivoca en los
-- dos sentidos: las horas extra tienen affectsSalaryIntegral=true (quedarian
-- como salario normal, inflando la base de cotizacion) y los feriados
-- trabajados lo tienen en false (quedarian como no salariales). Los cuatro son
-- salario de caracter accidental.
UPDATE "PayrollConcept" SET "salaryNature" = 'SALARIAL_ACCIDENTAL'
  WHERE "code" IN ('HE_DIURNA', 'HE_NOCTURNA', 'DOM_FERIADO', 'DESCANSO_COMP');

-- affectsSalaryIntegral queda VIVO a proposito: lo sigue leyendo
-- BenefitAccrualService para prestaciones. Se elimina en una migracion
-- posterior, cuando se resuelva el pendiente #2 del ADR-045.

-- Nombre de HE_NOCTURNA: decia "(100%)" mientras el calculador aplicaba 1,75 y
-- la ley da 1,95 (Art. 117 30% + Art. 118 50%, acumulados). Se renombra SOLO en
-- las filas que conservan el texto por defecto, para no pisar a quien lo haya
-- renombrado a mano.
UPDATE "PayrollConcept"
   SET "name" = 'Horas Extra Nocturnas (95%)'
 WHERE "code" = 'HE_NOCTURNA'
   AND "name" = 'Horas Extra Nocturnas (100%)';
